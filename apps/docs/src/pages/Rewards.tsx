import { Link } from "wouter";

export default function Rewards() {
  return (
    <>
      <div className="doc-eyebrow">Platform</div>
      <h1 className="doc-h1">Rewards</h1>
      <p className="doc-lead">
        Cookie Run rewards are an application-level record of useful participation
        around the platform. They are designed to make consistent, careful
        usage visible without turning a developer workspace into a speculative
        asset.
      </p>

      <h2 className="doc-h2">What can earn recognition</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Activity</th><th>Why it matters</th><th>Availability</th></tr>
        </thead>
        <tbody>
          {[
            ["Reliable workspace use", "Completing bounded runs and cleaning up runtimes", "Planned"],
            ["Useful feedback", "Reporting clear runtime, access, or lifecycle issues", "Planned"],
            ["Workflow contributions", "Sharing patterns that make ephemeral work safer", "Planned"],
            ["Community referrals", "Bringing in teams that are a good fit for temporary machines", "Planned"],
          ].map(([activity, why, availability]) => (
            <tr key={activity}>
              <td>{activity}</td>
              <td style={{ color: "var(--text-muted)" }}>{why}</td>
              <td><span className="tag">{availability}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="doc-h2">Reward ledger principles</h2>
      <div className="step-list">
        <div className="step">
          <div className="step-num">01</div>
          <div className="step-body">
            <h4>Server-recorded events</h4>
            <p>
              Reward events are recorded by the service after the relevant
              activity is verified. A client-side claim is not enough to create
              an entry.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">02</div>
          <div className="step-body">
            <h4>Cadence-aware</h4>
            <p>
              Repeated activities can have daily, cooldown, one-time, or
              per-workspace limits. Duplicate submissions should resolve
              gracefully rather than create duplicate credit.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">03</div>
          <div className="step-body">
            <h4>Transparent status</h4>
            <p>
              The product should distinguish earned, pending, reversed, and
              unavailable events so a reward balance never pretends to be more
              certain than its source activity.
            </p>
          </div>
        </div>
        <div className="step">
          <div className="step-num">04</div>
          <div className="step-body">
            <h4>No token promise</h4>
            <p>
              Cookie Run rewards are not described as a live on-chain token,
              investment, yield product, or guaranteed financial return.
            </p>
          </div>
        </div>
      </div>

      <div className="callout">
        <div className="callout-label">Product status</div>
        <p>
          Reward mechanics are part of the platform direction. Specific reward
          values, campaigns, and redemption rules should be treated as subject
          to product release notes, not as an API contract.
        </p>
      </div>

      <h2 className="doc-h2">Designed for healthy usage</h2>
      <p className="doc-p">
        The useful signal is not how long a machine stays alive. Rewards should
        favor focused runs, clean teardown, actionable feedback, and workflows
        that help teams keep sensitive work inside a controlled runtime.
      </p>

      <div className="doc-nav-footer">
        <Link href="/my-workspaces" className="doc-nav-btn">
          <span className="nav-label">Previous</span>
          <span className="nav-title">SSH access</span>
        </Link>
        <Link href="/staking" className="doc-nav-btn next">
          <span className="nav-label">Next</span>
          <span className="nav-title">Integration workflows →</span>
        </Link>
      </div>
    </>
  );
}