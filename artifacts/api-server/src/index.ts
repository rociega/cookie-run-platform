import app from "./app";
import { logger } from "./lib/logger";
import { attachTerminal } from "./lib/terminal";
import { startReconciliationLoop } from "./lib/reconcile";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Attach the WebSocket SSH-terminal bridge to the same HTTP server so it shares
// the artifact's single port and proxy path (/api).
attachTerminal(server);

// Periodically settle payments that were approved on-chain but whose /confirm
// call never finished, so a buyer who closed the tab still gets their
// download/instance and the seller is credited exactly once.
startReconciliationLoop();
