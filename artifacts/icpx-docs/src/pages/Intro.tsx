import { Link } from "wouter";

export default function Intro() {
  return (
    <>
      <div className="doc-eyebrow">Getting Started</div>
      <h1 className="doc-h1">What is Cookie Run?</h1>
      <p className="doc-lead">
        Cookie Run gives developers a clean, short-lived machine for work that
        should not linger. Create an isolated workspace, connect over SSH, run
        your toolchain, and let the environment disappear when the job is done.
      </p>

      <h2 className="doc-h2">The short version</h2>
      <p className="doc-p">
        Cookie Run is an ephemeral secure developer-machine platform. It is for
        preview builds, incident work, migration scripts, disposable test
        environments, and any task where a full local setup would slow you down
        or a permanent server would create unnecessary risk.
      </p>
      <p className="doc-p">
        A workspace is provisioned from a declared configuration, made
        reachable with short-lived SSH credentials, and isolated from other
        workspaces. Cookie Run keeps the workflow intentionally small: request,
        connect, work, collect the output, destroy.
      </p>

      <h2 className="doc-h2">What the platform covers</h2>
      <div className="step-list">
        <div className="step">
          <div className="step-num">01</div>
          <div className="step-body">
            <h4>Ephemeral workspaces</h4>
            <p>
              Start a named machine with the CPU, memory, image, and lifetime
              your task needs. Workspaces are disposable by design, not hidden
              long-running servers.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">02</div>
          <div className="step-body">
            <h4>SSH when ready</h4>
            <p>
              Once provisioning completes, Cookie Run exposes the connection
              details and a short-lived credential for the workspace. You can
              use the same terminal-first workflow you already trust.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">03</div>
          <div className="step-body">
            <h4>Isolated runtime security</h4>
            <p>
              Each machine gets a separate runtime boundary and a defined
              teardown path. Treat the environment as temporary, keep secrets
              scoped, and avoid assuming data survives destruction.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">04</div>
          <div className="step-body">
            <h4>Rewards for useful work</h4>
            <p>
              Rewards recognize reliable usage and useful contributions around
              the platform. The rewards ledger is an application feature, not a
              promise of a live token or financial return.
            </p>
          </div>
        </div>
      </div>

      <h2 className="doc-h2">Integration-ready, not integration-claimed</h2>
      <div className="callout">
        <div className="callout-label">Planned categories</div>
        <p>
          Cookie Run is being shaped to work with source hosts such as GitHub and
          GitLab, container registries, secrets managers, observability tools,
          and issue trackers. These are integration categories on the roadmap,
          not connectors that this documentation claims are live today.
        </p>
      </div>

      <h2 className="doc-h2">A useful mental model</h2>
      <p className="doc-p">
        Think of Cookie Run as a controlled handoff between your workflow and a
        temporary machine. The platform service provisions the workspace,
        exposes the minimum connection surface, tracks its state, and tears it
        down. Your code and artifacts remain yours to move out before expiry.
      </p>

      <div className="doc-nav-footer">
        <div />
        <Link href="/gpu-marketplace" className="doc-nav-btn next">
          <span className="nav-label">Next</span>
          <span className="nav-title">Workspace lifecycle →</span>
        </Link>
      </div>
    </>
  );
}