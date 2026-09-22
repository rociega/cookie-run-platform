import { Link } from "wouter";

export default function Staking() {
  return (
    <>
      <div className="doc-eyebrow">Platform</div>
      <h1 className="doc-h1">Integration workflows</h1>
      <p className="doc-lead">
        Cookie Run is being designed as a useful step inside existing engineering
        workflows, not as another walled-off dashboard. The categories below
        describe the handoffs that are live now and the future integration
        surfaces still being designed.
      </p>

      <div className="callout warn">
        <div className="callout-label">Current boundary</div>
        <p>
        Cookie Run currently supports a public GitHub repository reference and
          a public OCI image reference during workspace checkout. Private
          repository and registry credentials are not accepted or persisted.
          GitLab, secrets managers, observability systems, and issue trackers
          remain planned integration categories.
        </p>
      </div>

      <h2 className="doc-h2">A portable workflow shape</h2>
      <div className="step-list">
        <div className="step">
          <div className="step-num">01</div>
          <div className="step-body">
            <h4>Bring a source reference</h4>
            <p>
              A workflow can begin with a public GitHub repository and a
              branch, tag, or commit. Cookie Run verifies the reference
              server-side, then checks out the exact revision into the
              ephemeral workspace.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">02</div>
          <div className="step-body">
            <h4>Prepare an image and inputs</h4>
            <p>
              A public OCI registry may provide the runtime image. Registry
              passwords and tokens are intentionally outside the current
              contract; future secret-manager support must keep credentials
              scoped to the workspace lifetime.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">03</div>
          <div className="step-body">
            <h4>Run inside the workspace</h4>
            <p>
              The service provisions the machine, reports lifecycle status, and
              gives an operator or automation a bounded SSH path. Logs and
              health signals can be forwarded to planned observability
              destinations without making them part of the runtime contract.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">04</div>
          <div className="step-body">
            <h4>Return evidence and close</h4>
            <p>
              Publish a result, attach an artifact, update an issue, or retain
              a run summary where the team already works. Then destroy the
              workspace and revoke its access.
            </p>
          </div>
        </div>
      </div>

      <h2 className="doc-h2">Integration categories</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Category</th><th>Potential handoff</th><th>Status</th></tr>
        </thead>
        <tbody>
          {[
            ["GitHub", "Public repository and revision in; checked-out source in workspace", "Live"],
            ["Container images", "Public OCI image reference in; runtime image launched", "Live"],
            ["GitLab", "Source reference in; status or result out", "Planned"],
            ["Secrets managers", "Scoped runtime values in; no secret persistence", "Planned"],
            ["Observability", "Lifecycle events, logs, and health signals out", "Planned"],
            ["Issue trackers", "Task context in; run summary or artifact link out", "Planned"],
          ].map(([category, handoff, status]) => (
            <tr key={category}>
              <td>{category}</td>
              <td style={{ color: "var(--text-muted)" }}>{handoff}</td>
              <td><span className="tag">{status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="doc-h2">Integration rules worth keeping</h2>
      <ol className="doc-ol">
        <li className="doc-li">Pass references and scopes, not broad standing credentials.</li>
        <li className="doc-li">Make expiry and teardown visible to every caller.</li>
        <li className="doc-li">Keep source, secret, and artifact ownership with the connected system.</li>
        <li className="doc-li">Use lifecycle events as the durable boundary between steps.</li>
        <li className="doc-li">Make retries idempotent so a rerun cannot create abandoned machines.</li>
      </ol>

      <div className="doc-nav-footer">
        <Link href="/rewards" className="doc-nav-btn">
          <span className="nav-label">Previous</span>
          <span className="nav-title">Rewards</span>
        </Link>
      </div>
    </>
  );
}