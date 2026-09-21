import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, walletConnectionsTable } from "@workspace/db";
import { ConnectWalletBody } from "@workspace/api-zod";
import { sendEmail, notifyAdmin, walletWelcomeEmail, esc } from "../lib/email";

const router: IRouter = Router();

router.post("/wallet-connections", async (req, res): Promise<void> => {
  const parsed = ConnectWalletBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid wallet address is required" });
    return;
  }
  const { address, email } = parsed.data;

  const [existing] = await db
    .select()
    .from(walletConnectionsTable)
    .where(eq(walletConnectionsTable.address, address))
    .limit(1);
  const isNew = !existing;

  // Don't accumulate a new row on every reconnect; reuse the existing one and
  // refresh its email if a new one was supplied.
  let row: typeof existing;
  if (existing) {
    if (email && email !== existing.email) {
      [row] = await db
        .update(walletConnectionsTable)
        .set({ email })
        .where(eq(walletConnectionsTable.id, existing.id))
        .returning();
    } else {
      row = existing;
    }
  } else {
    [row] = await db
      .insert(walletConnectionsTable)
      .values({ address, email: email ?? null })
      .returning();
  }

  req.log.info({ id: row.id, isNew }, "wallet connected");

  if (isNew) {
    if (email) {
      void sendEmail({
        to: email,
        subject: "Wallet connected — welcome to ForgeRun",
        html: walletWelcomeEmail(address),
      });
    }
    void notifyAdmin(
      "New ForgeRun wallet connection",
      `<p>Wallet: <code>${esc(address)}</code>${email ? ` · ${esc(email)}` : ""}</p>`,
    );
  }

  res.status(201).json({
    id: row.id,
    address: row.address,
    email: row.email,
    isNew,
    createdAt: row.createdAt.toISOString(),
  });
});

export default router;
