import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  rewardAccountsTable,
  referralsTable,
  type RewardAccount,
} from "@workspace/db";
import { CreateAuthChallengeBody, VerifyAuthSignatureBody } from "@workspace/api-zod";
import { isRewardsConfigured } from "../lib/config";
import {
  createChallenge,
  isEthereumAddress,
  issueSession,
  normalizeWalletAddress,
  walletColumnEquals,
  verifySignedChallenge,
} from "../lib/walletAuth";
import {
  ACTION_MAP,
  REFERRAL_REWARD,
  earn,
  generateReferralCode,
  isUniqueViolation,
  onceKey,
  targetKey,
  serializeRewardAccount,
} from "../lib/rewards";

const router: IRouter = Router();

function requestDomain(req: Request): string | null {
  // req.hostname removes the port and is what the user sees as the site host.
  // walletAuth validates this again before including it in a signed message.
  const hostname = req.hostname?.toLowerCase();
  return hostname || null;
}

async function findOrCreateAccount(
  wallet: string,
  referredByCode: string | null,
): Promise<{ account: RewardAccount; isNew: boolean }> {
  const [existing] = await db
    .select()
    .from(rewardAccountsTable)
    .where(walletColumnEquals(rewardAccountsTable.walletAddress, wallet))
    .limit(1);
  if (existing) return { account: existing, isNew: false };

  for (let i = 0; i < 5; i++) {
    try {
      const [row] = await db
        .insert(rewardAccountsTable)
        .values({
          walletAddress: wallet,
          referralCode: generateReferralCode(),
          referredByCode,
        })
        .returning();
      return { account: row, isNew: true };
    } catch (e) {
      if (isUniqueViolation(e)) {
        // Either a concurrent first sign-in won the wallet, or the random
        // referral code collided. Reuse the wallet row if it now exists, else
        // retry with a fresh code.
        const [raced] = await db
          .select()
          .from(rewardAccountsTable)
          .where(walletColumnEquals(rewardAccountsTable.walletAddress, wallet))
          .limit(1);
        if (raced) return { account: raced, isNew: false };
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not create reward account");
}

router.post("/auth/challenge", async (req, res): Promise<void> => {
  if (!isRewardsConfigured()) {
    res.status(503).json({ error: "Rewards are not configured yet" });
    return;
  }
  const parsed = CreateAuthChallengeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid wallet address is required" });
    return;
  }
  const wallet = normalizeWalletAddress(parsed.data.wallet);
  if (!wallet) {
    res.status(400).json({ error: "Invalid wallet address" });
    return;
  }
  const domain = isEthereumAddress(wallet) ? requestDomain(req) : undefined;
  if (isEthereumAddress(wallet) && !domain) {
    res.status(400).json({ error: "Invalid request host" });
    return;
  }
  const { message, challengeToken } = createChallenge(wallet, domain ?? undefined);
  res.json({ message, challengeToken });
});

router.post("/auth/verify", async (req, res): Promise<void> => {
  if (!isRewardsConfigured()) {
    res.status(503).json({ error: "Rewards are not configured yet" });
    return;
  }
  const parsed = VerifyAuthSignatureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing signature fields" });
    return;
  }
  const { signature, challengeToken, referralCode } = parsed.data;
  const wallet = normalizeWalletAddress(parsed.data.wallet);
  if (!wallet) {
    res.status(400).json({ error: "Invalid wallet address" });
    return;
  }
  const domain = isEthereumAddress(wallet) ? requestDomain(req) : undefined;
  if (isEthereumAddress(wallet) && !domain) {
    res.status(400).json({ error: "Invalid request host" });
    return;
  }

  const verification = verifySignedChallenge({
    wallet,
    challengeToken,
    signature,
    expectedDomain: domain ?? undefined,
  });
  if (!verification.ok) {
    res.status(400).json({ error: verification.reason ?? "Verification failed" });
    return;
  }

  const [pre] = await db
    .select()
    .from(rewardAccountsTable)
    .where(walletColumnEquals(rewardAccountsTable.walletAddress, wallet))
    .limit(1);

  // Resolve a referrer only for brand-new accounts; ignore self-referral.
  let referredByCode: string | null = null;
  let referrer: RewardAccount | undefined;
  if (!pre && referralCode) {
    const [r] = await db
      .select()
      .from(rewardAccountsTable)
      .where(eq(rewardAccountsTable.referralCode, referralCode))
      .limit(1);
    if (r && r.walletAddress !== wallet) {
      referrer = r;
      referredByCode = referralCode;
    }
  }

  const { account, isNew } = await findOrCreateAccount(wallet, referredByCode);

  if (isNew && referrer) {
    await db
      .insert(referralsTable)
      .values({
        referrerAccountId: referrer.id,
        refereeAccountId: account.id,
        qualifiedAt: new Date(),
      })
      .onConflictDoNothing();
    await earn({
      account: referrer,
      actionType: "referral_qualified",
      amount: REFERRAL_REWARD,
      idempotencyKey: targetKey(referrer.id, "referral_qualified", account.id),
      emailNote: "Someone you referred just signed in to ICPX.",
    });
  }

  // Sign-in bonus (once per account).
  await earn({
    account,
    actionType: "connect_wallet",
    amount: ACTION_MAP.connect_wallet.amount,
    idempotencyKey: onceKey(account.id, "connect_wallet"),
  });

  const [fresh] = await db
    .select()
    .from(rewardAccountsTable)
    .where(eq(rewardAccountsTable.id, account.id))
    .limit(1);

  req.log.info({ wallet, isNew }, "wallet signed in to rewards");
  const token = issueSession(wallet);
  res.json({ token, account: serializeRewardAccount(fresh) });
});

export default router;
