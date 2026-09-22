import { Link } from "wouter";

export default function GpuMarketplace() {
  return (
    <>
      <div className="doc-eyebrow">Workspaces</div>
      <h1 className="doc-h1">Workspace lifecycle</h1>
      <p className="doc-lead">
        A Cookie Run workspace is a deliberate, finite run of a developer
        machine. Declare what you need, wait for the service layer to prepare
        it, use it over SSH, then preserve your output before teardown.
      </p>

      <h2 className="doc-h2">From request to teardown</h2>
      <div className="step-list">
        <div className="step">
          <div className="step-num">01</div>
          <div className="step-body">
            <h4>Declare the workspace</h4>
            <p>
              Choose a workspace name, runtime image, compute shape, lifetime,
              and the environment inputs your task requires. Keep the
              declaration narrow: temporary machines should start with a
              temporary purpose.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">02</div>
          <div className="step-body">
            <h4>Provision and prepare</h4>
            <p>
              The provisioning service allocates capacity, boots the image,
              applies the workspace configuration, and waits for its health
              checks. A workspace is not ready until the service reports it as
              reachable.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">03</div>
          <div className="step-body">
            <h4>Connect and work</h4>
            <p>
        Cookie Run returns the SSH host, port, and short-lived credential
              once the runtime is ready. Use the machine for your build,
              debugging session, migration, or test run without turning it into
              a permanent environment.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">04</div>
          <div className="step-body">
            <h4>Export, then destroy</h4>
            <p>
              Move logs, patches, build artifacts, or other required output
              somewhere durable before the expiry window. Teardown revokes
              access and releases the runtime; it is not a pause button.
            </p>
          </div>
        </div>
      </div>

      <h2 className="doc-h2">State lifecycle</h2>
      <table className="doc-table">
        <thead>
          <tr><th>State</th><th>Meaning</th><th>What you can do</th></tr>
        </thead>
        <tbody>
          {[
            ["requested", "Workspace declaration accepted", "Review configuration"],
            ["provisioning", "Machine and runtime are being prepared", "Wait for readiness"],
            ["ready", "Health checks passed and SSH can be issued", "Connect over SSH"],
            ["running", "Workspace is available for active work", "Run your workflow"],
            ["expiring", "Lifetime is nearly complete", "Export output"],
            ["destroyed", "Runtime access has been revoked", "Create a new workspace"],
            ["error", "Provisioning or teardown needs attention", "Inspect the service message"],
          ].map(([state, meaning, action]) => (
            <tr key={state}>
              <td><code>{state}</code></td>
              <td>{meaning}</td>
              <td style={{ color: "var(--text-muted)" }}>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="callout warn">
        <div className="callout-label">Design constraint</div>
        <p>
          Ephemeral means disposable. Do not use a workspace as the only home
          for source code, credentials, or artifacts. Plan an export step before
          the workspace reaches its expiry state.
        </p>
      </div>

      <h2 className="doc-h2">Automation shape</h2>
      <p className="doc-p">
        A future workflow can request a workspace, wait for <code>ready</code>,
        run a bounded task, stream status to an observability system, and
        destroy the machine in a finally block. Cookie Run documents this shape
        now so integrations can be built around explicit lifecycle events.
      </p>
      <code className="doc-code">{`request → provision → ready → run → export → destroy`}</code>

      <div className="doc-nav-footer">
        <Link href="/" className="doc-nav-btn">
          <span className="nav-label">Previous</span>
          <span className="nav-title">What is Cookie Run?</span>
        </Link>
        <Link href="/my-workspaces" className="doc-nav-btn next">
          <span className="nav-label">Next</span>
          <span className="nav-title">SSH access →</span>
        </Link>
      </div>
    </>
  );
}