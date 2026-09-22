import { useEffect, useState, useMemo } from "react";
import { Link } from "wouter";
import "../public-landing.css";
import LifecycleSequence from "../components/landing/LifecycleSequence";

const SvgArrowRightUp = () => (
  <svg width="12" height="12" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="8" strokeLinejoin="miter">
    <path d="M20 80 L80 20 M30 20 L80 20 L80 70" />
  </svg>
);

const SvgPlay = () => (
  <svg width="16" height="16" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="miter">
    <polygon points="35,25 35,75 75,50" />
  </svg>
);

const TechIcon = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="miter">
    {children}
  </svg>
);

const SvgTerminal = () => (
  <TechIcon>
    <rect x="15" y="20" width="70" height="60" />
    <path d="M30 40 L45 50 L30 60 M55 60 L70 60" />
  </TechIcon>
);

const SvgDocker = () => (
  <TechIcon>
    <path d="M20 40 L50 25 L80 40 L80 70 L50 85 L20 70 Z" />
    <path d="M50 25 L50 55 M20 40 L50 55 L80 40 M50 55 L50 85" />
    <circle cx="50" cy="55" r="4" fill="currentColor" />
  </TechIcon>
);

const SvgCUDA = () => (
  <TechIcon>
    <rect x="25" y="25" width="50" height="50" />
    <rect x="40" y="40" width="20" height="20" fill="currentColor" />
    <path d="M25 35 L10 35 M25 50 L10 50 M25 65 L10 65" />
    <path d="M75 35 L90 35 M75 50 L90 50 M75 65 L90 65" />
    <path d="M35 25 L35 10 M50 25 L50 10 M65 25 L65 10" />
    <path d="M35 75 L35 90 M50 75 L50 90 M65 75 L65 90" />
  </TechIcon>
);

const SvgPyTorch = () => (
  <TechIcon>
    <circle cx="50" cy="25" r="10" />
    <circle cx="25" cy="75" r="10" />
    <circle cx="75" cy="75" r="10" />
    <path d="M45 32 L30 68 M55 32 L70 68 M33 75 L67 75" />
  </TechIcon>
);

const SvgJupyter = () => (
  <TechIcon>
    <ellipse cx="50" cy="30" rx="30" ry="12" />
    <ellipse cx="50" cy="50" rx="30" ry="12" strokeDasharray="4 4" />
    <ellipse cx="50" cy="70" rx="30" ry="12" />
    <path d="M20 30 L20 70 M80 30 L80 70" />
  </TechIcon>
);

const SvgVSCode = () => (
  <TechIcon>
    <path d="M35 25 L15 50 L35 75" />
    <path d="M65 25 L85 50 L65 75" />
    <path d="M55 15 L45 85" strokeDasharray="4 4" />
  </TechIcon>
);

const SvgHardwareBullet = () => (
  <svg width="20" height="20" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="5" className="hw-bullet">
    <rect x="20" y="20" width="60" height="60" />
    <rect x="35" y="35" width="30" height="30" fill="currentColor" />
  </svg>
);

const SvgBgGrid = () => (
  <svg className="bg-grid-deco" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1" preserveAspectRatio="none">
    <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
      <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.5" />
    </pattern>
    <rect width="100" height="100" fill="url(#grid)" />
    <circle cx="50" cy="50" r="20" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1 1"/>
    <path d="M 0 50 L 100 50 M 50 0 L 50 100" fill="none" stroke="currentColor" strokeWidth="0.5" />
  </svg>
);

const SvgFooterDeco = () => (
  <svg className="footer-deco" viewBox="0 0 100 20" fill="none" stroke="currentColor" strokeWidth="1">
    <path d="M0 10 L100 10" strokeDasharray="2 4" />
    <rect x="45" y="5" width="10" height="10" fill="#000" />
  </svg>
);

const PixelGrid = () => {
  const grid = useMemo(() => {
    const cols = 40;
    const rows = 14;
    const cells = [];
    
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let active = false;
        let muted = false;
        
        if ((x > 10 && x < 15 && y > 4 && y < 10) || 
            (x >= 15 && x < 25 && y > 2 && y < 12) || 
            (x >= 25 && x < 32 && y > 5 && y < 9) ||
            (x > 8 && x < 35 && y === 7)) {
          if (Math.random() > 0.2) active = true;
          else muted = true;
        } else if (Math.random() > 0.9) {
          muted = true;
        }

        let className = "pixel-cell";
        if (active) className += " active";
        else if (muted) className += " muted";
        
        cells.push(
          <div 
            key={`${x}-${y}`} 
            className={className} 
            style={{ animationDelay: `${(Math.random() * -4).toFixed(2)}s` }} 
          />
        );
      }
    }
    return cells;
  }, []);
  
  return (
    <div className="pixel-grid-container">
      <div className="pixel-grid-wrapper">
        <div className="pixel-grid">{grid}</div>
      </div>
      
      <div className="brand-float">
        <img src={`${import.meta.env.BASE_URL}cookie-run-mark-transparent.png`} alt="" width="44" height="44" />
        COOKIE RUN
      </div>
      <div className="scroll-indicator">
        SCROLL FOR MORE &darr;
      </div>
    </div>
  );
};

export default function PublicLanding() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Skip to content</a>

      <div className="hero-dark-section">
        <nav className="floating-nav" aria-label="Primary navigation">
          <div className="floating-pill left-pill">
            <div className="pill-desktop-only">
              <Link href="/gpus" className="pill-item">HARDWARE</Link>
              <a href="/docs/" className="pill-item">DOCS</a>
              <Link href="/workspaces" className="pill-item">WORKSPACES</Link>
            </div>
            <button 
              className="pill-item mobile-only" 
              type="button" 
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="editorial-mobile-nav"
            >
              {menuOpen ? "CLOSE" : "MENU"}
            </button>
          </div>
          <div className="floating-pill right-pill">
            <Link href="/platform" className="pill-item action-item">
              <SvgArrowRightUp /> OPEN PLATFORM
            </Link>
          </div>
        </nav>
        <div className="header-center-links">
          <a
            className="header-x-link"
             href="https://x.com/0xBasilisca"
            target="_blank"
            rel="noreferrer"
            aria-label="Follow Cookie Run on X"
          >
            X <SvgArrowRightUp />
          </a>
        </div>

        {menuOpen && (
          <div id="editorial-mobile-nav" className="mobile-nav-takeover">
            <div className="mobile-nav-inner">
              <Link href="/gpus" className="mobile-link" onClick={() => setMenuOpen(false)}>HARDWARE</Link>
              <a href="/docs/" className="mobile-link" onClick={() => setMenuOpen(false)}>DOCS</a>
              <Link href="/workspaces" className="mobile-link" onClick={() => setMenuOpen(false)}>WORKSPACES</Link>
            </div>
          </div>
        )}

        <PixelGrid />

        <div className="hero-marquee-band">
          <div className="marquee-content mono">
            <span>+ EPHEMERAL WORKSPACES</span>
            <span>+ REAL GPU COMPUTE</span>
            <span>+ PAY ONLY WHILE IT RUNS</span>
            <span>+ EPHEMERAL WORKSPACES</span>
            <span>+ REAL GPU COMPUTE</span>
            <span>+ PAY ONLY WHILE IT RUNS</span>
            <span>+ EPHEMERAL WORKSPACES</span>
            <span>+ REAL GPU COMPUTE</span>
            <span>+ PAY ONLY WHILE IT RUNS</span>
          </div>
        </div>
      </div>

      <main id="main-content">
        <section className="headline-section" data-testid="public-hero">
          <div className="headline-grid">
            <div className="headline-left">
              <h1 className="hero-title">
                Real GPU Compute<br/>
                [ <span className="highlight-block">Without</span> ]<br/>
                The Server Upkeep.
              </h1>
            </div>
            <div className="headline-right">
              <div className="right-desc-box">
                <p className="headline-desc">
                  Spin up an isolated developer machine for a build, a model run, or the idea you need to test today. SSH in like normal. Pay only while it runs.
                </p>
                <div className="headline-actions">
                  <div className="btn-group">
                    <Link href="/platform" className="btn-black-main">GET STARTED</Link>
                    <Link href="/platform" className="btn-black-icon" aria-label="Open Platform"><SvgPlay /></Link>
                  </div>
                  <a href="#workflow" className="link-text"><SvgPlay /> SEE HOW IT WORKS</a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="trust-strip">
          <div className="trust-item"><SvgTerminal /> <span>SSH</span></div>
          <div className="trust-item"><SvgDocker /> <span>Docker</span></div>
          <div className="trust-item"><SvgCUDA /> <span>CUDA</span></div>
          <div className="trust-item"><SvgPyTorch /> <span>PyTorch</span></div>
          <div className="trust-item"><SvgJupyter /> <span>Jupyter</span></div>
          <div className="trust-item"><SvgVSCode /> <span>VS Code</span></div>
        </div>

        <div className="addon-band-container">
          <div className="addon-band-inner mono">
            <span className="addon-dots">...</span>
            <span className="addon-arrow">&gt;</span>
            <span className="addon-label">WORKSPACE</span>
            <span className="addon-arrow">&rarr;</span>
            <span className="addon-text">INTELLIGENT PROVISIONING FOR</span>
            <span className="addon-icon"><SvgTerminal /></span>
            <span className="addon-text">YOUR STACK</span>
            <span className="addon-arrow">&lt;</span>
            <span className="addon-dots">...</span>
          </div>
        </div>

        <LifecycleSequence />

        <section className="hw-section relative overflow-hidden">
          <SvgBgGrid />
          <div className="hw-container relative z-10">
            <div className="hw-header-row">
              <div className="hw-header-left">
                <div className="features-kicker mono">[02/11] ↗ HARDWARE</div>
                <h2 className="features-title">THE RIGHT WEIGHT FOR THE WORK.</h2>
              </div>
            </div>

            <div className="hw-table">
              <div className="hw-row">
                <div className="hw-name"><SvgHardwareBullet /> A10G</div>
                <div className="hw-desc">Representative architecture for inference and mid-tier training.</div>
                <div><Link href="/gpus" className="btn-outline">VIEW SPECS</Link></div>
              </div>
              <div className="hw-row">
                <div className="hw-name"><SvgHardwareBullet /> RTX 4090</div>
                <div className="hw-desc">Representative architecture for rapid prototyping and general purpose compute.</div>
                <div><Link href="/gpus" className="btn-outline">VIEW SPECS</Link></div>
              </div>
              <div className="hw-row">
                <div className="hw-name"><SvgHardwareBullet /> H100</div>
                <div className="hw-desc">Representative architecture for large-scale modeling and heavy parallel loads.</div>
                <div><Link href="/gpus" className="btn-outline">VIEW SPECS</Link></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-left">
          <div className="footer-brand">
            COOKIE RUN
          </div>
          <span className="footer-slogan mono">SHORT-LIVED MACHINES FOR SERIOUS WORK.</span>
          <SvgFooterDeco />
        </div>
        
        <div className="footer-links mono">
          <Link href="/platform">Platform</Link>
          <Link href="/gpus">Hardware</Link>
          <a href="/docs/">Documentation</a>
          <Link href="/workspaces">Workspaces</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://x.com/0xBasilisca" target="_blank" rel="noreferrer" aria-label="Follow on X">X ↗</a>
        </div>
      </footer>
    </div>
  );
}
