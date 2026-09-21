import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="not-found-page">
      <div className="doc-eyebrow">Routing error</div>
      <h1 className="doc-h1">404 — page not found</h1>
      <p className="doc-lead">Did you forget to add the page to the router?</p>
      <Link href="/" className="doc-nav-btn" data-testid="link-back-to-docs">
        <span className="nav-label">Return</span>
        <span className="nav-title">What is Cookie Run? →</span>
      </Link>
    </div>
  );
}
