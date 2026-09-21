import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import "./auth-layout.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <section className="auth-intro" aria-labelledby="auth-heading">
        <Link href="/" className="auth-wordmark"><img src={`${import.meta.env.BASE_URL}cookie-run-mark-transparent.png`} width="40" height="40" alt="" />Cookie Run</Link>
        <div className="auth-intro-content">
          <span className="auth-eyebrow">[ SYSTEM ACCESS ]</span>
          <h1 id="auth-heading">Less setup.<br />More execution.</h1>
          <p>A developer machine for the work in front of you. Choose your hardware, review a precise quote, and connect with the tools you already use.</p>
          <dl className="auth-facts">
            <div><dt>01 // One-hour rentals</dt><dd>A defined compute session without the subscription overhead.</dd></div>
            <div><dt>02 // Your tools, your workflow</dt><dd>Native SSH integration directly to your provisioned workspace.</dd></div>
          </dl>
        </div>
        <a className="auth-docs" href={`${import.meta.env.BASE_URL}docs/`}>Explore Documentation <ArrowUpRight size={16} /></a>
      </section>
      <section className="auth-form-area" aria-label="Account access">
        <Link href="/" className="auth-back"><ArrowLeft size={16} /> Return to Index</Link>
        <div className="auth-form-content">
          {children}
          <p className="auth-wallet-note">Your account and wallet are structurally isolated. Connect a wallet to authorize compute resources.</p>
        </div>
        <div className="auth-policy"><Link href="/privacy">Privacy Policy</Link><Link href="/cookies">Cookie Policy</Link></div>
      </section>
    </main>
  );
}