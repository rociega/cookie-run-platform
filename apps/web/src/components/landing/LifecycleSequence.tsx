import React from 'react';
import { Link } from "wouter";

const SvgPlay = () => (
  <svg width="16" height="16" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="miter">
    <polygon points="35,25 35,75 75,50" />
  </svg>
);

const SvgGeometric1 = () => (
  <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter">
    <circle cx="50" cy="50" r="30" fill="#fff" stroke="#000" strokeWidth="2" />
    <path d="M20 50 A30 30 0 0 1 50 20" stroke="#000" strokeWidth="6" fill="none" />
    <rect x="75" y="45" width="10" height="10" fill="#000" />
  </svg>
);

const SvgGeometric2 = () => (
  <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter">
    <path d="M30 60 L70 60 L80 40 L40 40 Z" fill="#000" stroke="none" />
    <path d="M30 70 L70 70 L80 50 L40 50 Z" fill="none" stroke="#000" strokeWidth="2" />
    <path d="M30 80 L70 80 L80 60 L40 60 Z" fill="none" stroke="#000" strokeWidth="2" strokeDasharray="2 4" />
  </svg>
);

const SvgGeometric3 = () => (
  <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter">
    <polygon points="50,15 61,35 85,35 66,50 73,75 50,60 27,75 34,50 15,35 39,35" fill="none" stroke="#000" strokeWidth="2" />
    <circle cx="50" cy="50" r="5" fill="#000" stroke="none" />
  </svg>
);

export default function LifecycleSequence() {
  return (
    <section id="workflow" className="features-section">
      <div className="features-header">
        <div className="features-header-left">
          <div className="features-kicker mono">
            [ N.01/03 ] &gt; KEY VALUE
          </div>
          <h2 className="features-title">
            / Less manual work.<br/>
            More intelligent execution. /
          </h2>
        </div>
        <div className="features-header-right">
          <div className="btn-group">
            <Link href="/platform" className="btn-black-main">GET STARTED</Link>
            <Link href="/platform" className="btn-black-icon"><SvgPlay /></Link>
          </div>
        </div>
      </div>
      
      <div className="features-grid">
        <div className="feat-card">
          <div className="feat-num mono">// 001</div>
          <div className="feat-graphic">
            <SvgGeometric1 />
          </div>
          <h3 className="feat-title">Smart Provisioning</h3>
          <p className="feat-desc">Pick a workload template or specify the exact GPU, CPU, memory, and region your experiment requires.</p>
        </div>
        
        <div className="feat-card">
          <div className="feat-num mono">// 002</div>
          <div className="feat-graphic">
            <SvgGeometric2 />
          </div>
          <h3 className="feat-title">Native Connectivity</h3>
          <p className="feat-desc">Use a normal SSH connection. Keep your terminal, editor, containers, and familiar workflow completely intact.</p>
        </div>

        <div className="feat-card">
          <div className="feat-num mono">// 003</div>
          <div className="feat-graphic">
            <SvgGeometric3 />
          </div>
          <h3 className="feat-title">Ephemeral Release</h3>
          <p className="feat-desc">When the session ends, the machine is gone. No idle bill and no permanent server to babysit.</p>
        </div>
      </div>
    </section>
  );
}
