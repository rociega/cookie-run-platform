import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Lightweight sink for client-side payment errors. Browser wallet/send failures
// never reach the server otherwise, so without this a failing pay flow is
// invisible in production logs. Intentionally permissive and fire-and-forget: it
// only logs (capped) and always 204s, and is deliberately NOT part of the
// OpenAPI client (no codegen, no contract surface).
router.post("/client-errors", (req, res): void => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;
  req.log.warn(
    {
      stage: str(b.stage, 40),
      name: str(b.name, 80),
      message: str(b.message, 500),
      wallet: str(b.wallet, 64),
    },
    "client payment error",
  );
  res.status(204).end();
});

export default router;
