import { Link } from "wouter";

export default function MyRentals() {
  return (
    <>
      <div className="doc-eyebrow">Workspaces</div>
      <h1 className="doc-h1">SSH access</h1>
      <p className="doc-lead">
        SSH is the primary human interface to a Cookie Run workspace. Access is
        issued for the workspace lifecycle, shown only to an authorized
        operator, and revoked when the runtime is destroyed.
      </p>

      <h2 className="doc-h2">The access sequence</h2>
      <div className="step-list">
        <div className="step">
          <div className="step-num">01</div>
          <div className="step-body">
            <h4>Authenticate to Cookie Run</h4>
            <p>
              Establish your Cookie Run identity through the platform's
              authentication flow. The workspace owner is resolved by the
              service, not by an address typed into a request.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">02</div>
          <div className="step-body">
            <h4>Wait for ready</h4>
            <p>
              Connection details are not exposed while the machine is still
              provisioning. The service first confirms that the runtime has
              passed its readiness checks.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">03</div>
          <div className="step-body">
            <h4>Copy a scoped command</h4>
            <p>
              The workspace view provides the host, port, user, and credential
              material needed for an SSH session. Treat these details as
              sensitive and never commit them to a repository or issue.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">04</div>
          <div className="step-body">
            <h4>Disconnect on teardown</h4>
            <p>
              When the workspace expires or is destroyed, the connection path
              closes and the short-lived access material is no longer valid.
              Export anything you need before that point.
            </p>
          </div>
        </div>
      </div>

      <h2 className="doc-h2">Connection details</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Field</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          {[
            ["SSH command", "A ready-to-copy command assembled for the workspace"],
            ["Host and port", "The reachable endpoint while the workspace is ready"],
            ["Runtime user", "The user configured by the workspace image"],
            ["Credential state", "Whether scoped access is available or revoked"],
            ["Workspace status", "Current lifecycle state and service message"],
            ["Expiry", "The deadline by which output should be exported"],
          ].map(([field, desc]) => (
            <tr key={field}>
              <td>{field}</td>
              <td style={{ color: "var(--text-muted)" }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="callout">
        <div className="callout-label">Security boundary</div>
        <p>
          Cookie Run treats connection details as workspace secrets. Access is
          returned only after the requesting identity is authorized for that
          workspace. A workspace identifier alone is not a credential.
        </p>
      </div>

      <h2 className="doc-h2">Practical SSH hygiene</h2>
      <ul className="doc-ul">
        <li className="doc-li">Use a dedicated local SSH profile for temporary hosts.</li>
        <li className="doc-li">Keep private key material outside source repositories and shared logs.</li>
        <li className="doc-li">Treat shell history, terminal recordings, and CI output as sensitive.</li>
        <li className="doc-li">Prefer exporting artifacts over keeping a workspace alive “just in case.”</li>
        <li className="doc-li">Destroy the workspace early when the task is complete.</li>
      </ul>

      <h2 className="doc-h2">Machine-readable workflows</h2>
      <p className="doc-p">
        SSH access is also the handoff point for automation. A planned workflow
        can consume the ready event, obtain scoped connection details, execute
        a bounded command, collect output, and ask the service to destroy the
        workspace. Connector availability is intentionally not implied here.
      </p>

      <div className="doc-nav-footer">
        <Link href="/gpu-marketplace" className="doc-nav-btn">
          <span className="nav-label">Previous</span>
          <span className="nav-title">Workspace lifecycle</span>
        </Link>
        <Link href="/rewards" className="doc-nav-btn next">
          <span className="nav-label">Next</span>
          <span className="nav-title">Rewards →</span>
        </Link>
      </div>
    </>
  );
}