import { Router, type IRouter } from "express";
import healthRouter from "./health";
import whitelistRouter from "./whitelist";
import walletRouter from "./wallet";
import workspacesRouter from "./workspaces";
import clientErrorsRouter from "./clientErrors";
import solanaRouter from "./solana";
import authRouter from "./auth";
import rewardsRouter from "./rewards";
import stakesRouter from "./stakes";
import networkRouter from "./network";
import gpusRouter from "./gpus";
import benchmarksRouter from "./benchmarks";
import marketplaceRouter from "./marketplace";
import developerRouter from "./developer";
import agentRunsRouter from "./agentRuns";

const router: IRouter = Router();

router.use(healthRouter);
router.use(whitelistRouter);
router.use(walletRouter);
router.use(workspacesRouter);
router.use(clientErrorsRouter);
router.use(solanaRouter);
router.use(authRouter);
router.use(rewardsRouter);
router.use(stakesRouter);
router.use(networkRouter);
router.use(gpusRouter);
router.use(benchmarksRouter);
router.use(marketplaceRouter);
router.use(developerRouter);
router.use(agentRunsRouter);

export default router;
