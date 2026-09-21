import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, apiKeysTable, type ApiKey } from "@workspace/db";
import { MintApiKeyBody } from "@workspace/api-zod";
import { requireAuth, currentAccount } from "../lib/walletAuth";
import { generateApiKey } from "../lib/apiKeys";
import { isUniqueViolation } from "../lib/rewards";

const router: IRouter = Router();

// Max active (non-revoked) keys per account — bounds abuse and keeps the
// management UI sane. Revoke to free a slot.
const MAX_ACTIVE_KEYS = 20;

// Never includes keyHash or the plaintext — only the non-secret display fields.
function serializeApiKey(k: ApiKey) {
  return {
    id: k.id,
    label: k.label,
    displayPrefix: k.displayPrefix,
    last4: k.last4,
    revoked: k.revoked,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
  };
}

// All routes are wallet-session authed (requireAuth): minting/listing/revoking
// keys is account management, never something an API key itself may do.
router.get("/developer/api-keys", requireAuth, async (_req, res): Promise<void> => {
  const account = currentAccount(res);
  const rows = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.accountId, account.id))
    .orderBy(desc(apiKeysTable.createdAt));
  res.json(rows.map(serializeApiKey));
});

router.post("/developer/api-keys", requireAuth, async (req, res): Promise<void> => {
  const parsed = MintApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A label between 1 and 60 characters is required" });
    return;
  }
  const label = parsed.data.label.trim();
  if (!label) {
    res.status(400).json({ error: "A label is required" });
    return;
  }
  const account = currentAccount(res);

  const active = await db
    .select({ id: apiKeysTable.id })
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.accountId, account.id), eq(apiKeysTable.revoked, false)));
  if (active.length >= MAX_ACTIVE_KEYS) {
    res.status(409).json({ error: "Key limit reached — revoke an existing key first" });
    return;
  }

  const { plaintext, keyHash, displayPrefix, last4 } = generateApiKey();
  try {
    const [row] = await db
      .insert(apiKeysTable)
      .values({ accountId: account.id, label, keyHash, displayPrefix, last4 })
      .returning();
    req.log.info({ id: row.id, accountId: account.id }, "api key minted");
    // The plaintext key is returned exactly once — it is never retrievable again.
    res.status(201).json({ key: plaintext, apiKey: serializeApiKey(row) });
  } catch (e) {
    if (isUniqueViolation(e)) {
      res.status(409).json({ error: "Could not mint a key — please try again" });
      return;
    }
    throw e;
  }
});

// Revoke is scoped to the owner (accountId guard) and returns 404 for a
// non-owner or unknown id, so one account can never revoke another's key (IDOR).
router.delete("/developer/api-keys/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const account = currentAccount(res);
  const updated = await db
    .update(apiKeysTable)
    .set({ revoked: true, revokedAt: new Date() })
    .where(
      and(
        eq(apiKeysTable.id, id),
        eq(apiKeysTable.accountId, account.id),
        eq(apiKeysTable.revoked, false),
      ),
    )
    .returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeApiKey(updated[0]));
});

export default router;
