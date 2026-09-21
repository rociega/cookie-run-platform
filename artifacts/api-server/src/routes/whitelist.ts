import { Router, type IRouter } from "express";
import { db, whitelistTable } from "@workspace/db";
import { JoinWhitelistBody } from "@workspace/api-zod";
import { sendEmail, notifyAdmin, whitelistConfirmationEmail } from "../lib/email";

const router: IRouter = Router();

router.post("/whitelist", async (req, res): Promise<void> => {
  const parsed = JoinWhitelistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  const { email, walletAddress, source } = parsed.data;

  const [row] = await db
    .insert(whitelistTable)
    .values({
      email,
      walletAddress: walletAddress ?? null,
      source: source ?? null,
    })
    .returning();

  req.log.info({ id: row.id }, "whitelist signup");

  void sendEmail({
    to: email,
    subject: "You're on the ForgeRun early-access list",
    html: whitelistConfirmationEmail(email),
  });
  void notifyAdmin(
    "New ForgeRun early-access signup",
    `<p>New signup: <b style="color:#fff">${email}</b>${
      walletAddress ? ` · wallet <code>${walletAddress}</code>` : ""
    }</p>`,
  );

  res.status(201).json({
    id: row.id,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  });
});

export default router;
