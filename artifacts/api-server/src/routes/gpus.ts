import { Router, type IRouter } from "express";
import { getGpuCatalog } from "../lib/gpuCatalog";
import { isVastConfigured } from "../lib/config";

const router: IRouter = Router();

// Public, aggregated live GPU market for the explorer page. The catalog is
// cached server-side for ~45s; a short public Cache-Control lets the proxy and
// browser reuse it too. Fail-soft to 503 if the GPU provider is unreachable.
router.get("/gpus", async (req, res): Promise<void> => {
  if (!isVastConfigured()) {
    res.status(503).json({ error: "GPU provider is not configured yet" });
    return;
  }
  try {
    const catalog = await getGpuCatalog();
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(catalog);
  } catch (err) {
    req.log.error({ err }, "gpu catalog fetch failed");
    res.status(503).json({ error: "Unable to reach the GPU provider" });
  }
});

export default router;
