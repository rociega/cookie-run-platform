import { Router, type IRouter } from "express";
import { networkStats } from "../lib/network";

const router: IRouter = Router();

// Public synthetic telemetry for the homepage. Cheap (no DB) and changes every
// poll, so it must never be cached by the proxy or the browser.
router.get("/network/stats", (_req, res): void => {
  res.setHeader("Cache-Control", "no-store");
  res.json(networkStats());
});

export default router;
