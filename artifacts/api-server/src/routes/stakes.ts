import { Router, type IRouter } from "express";
import { CreateStakeBody } from "@workspace/api-zod";
import { requireAuth, currentAccount } from "../lib/walletAuth";
import { listStakes, stake, unstake } from "../lib/staking";

const router: IRouter = Router();

router.get("/rewards/stakes", requireAuth, async (_req, res): Promise<void> => {
  const account = currentAccount(res);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await listStakes(account));
});

router.post("/rewards/stakes", requireAuth, async (req, res): Promise<void> => {
  const account = currentAccount(res);
  const parsed = CreateStakeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid stake request" });
    return;
  }
  // Business outcomes (min stake, unknown tier, insufficient balance) come back
  // as 200 with ok:false — same convention as the earn endpoints.
  res.json(await stake(account, parsed.data.amount, parsed.data.lockDays));
});

router.post(
  "/rewards/stakes/:id/unstake",
  requireAuth,
  async (req, res): Promise<void> => {
    const account = currentAccount(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid stake id" });
      return;
    }
    res.json(await unstake(account, id));
  },
);

export default router;
