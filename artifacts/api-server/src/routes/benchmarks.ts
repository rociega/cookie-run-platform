import { Router, type IRouter } from "express";
import { getBenchmarkCatalog } from "../lib/benchmarks";

const router: IRouter = Router();

// Public, curated GPU performance benchmarks for the comparison page. This is
// static curated data, so it can be cached aggressively at the edge/browser.
router.get("/benchmarks", (_req, res): void => {
  const catalog = getBenchmarkCatalog();
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(catalog);
});

export default router;
