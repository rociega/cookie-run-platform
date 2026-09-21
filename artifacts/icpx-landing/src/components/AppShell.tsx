import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, ArrowUpRight, BookOpen, ChevronRight, Cpu, Gauge, Gift, LayoutDashboard, Menu, Server, Store, X } from "lucide-react";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import { useUser } from "@clerk/react";
import { useRewardsAuth } from "@/lib/rewardsAuth";
import "./app-shell.css";

const nav = [
  { href: "/platform", label: "Overview", icon: LayoutDashboard },
  { href: "/gpus", label: "Machines", icon: Cpu },
  { href: "/workspaces", label: "Workspaces", icon: Server },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/rewards", label: "Rewards", icon: Gift },
  { href: "/stats", label: "Network activity", icon: Activity },
  { href: "/benchmarks", label: "Benchmarks", icon: Gauge },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isAuthed, connected, signOut } = useRewardsAuth();
  const { isSignedIn } = useUser();
  const toggle = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const active = (href: string) =>
    location === href ||
    (href === "/platform" && location === "/dashboard") ||
    (href === "/workspaces" && location === "/rentals") ||
    (href === "/rewards" && location === "/earn-icpx");
  const current = nav.find((item) => active(item.href))?.label ?? (location === "/privacy" ? "Privacy policy" : location === "/cookies" ? "Cookie policy" : "Page not found");
  
  useEffect(() => { setMobileOpen(false); }, [location]);
  
  useEffect(() => {
    if (!mobileOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMobileOpen(false); toggle.current?.focus(); }
      if (e.key !== "Tab") return;
      const controls = Array.from(drawer.current?.querySelectorAll<HTMLElement>("a,button") ?? []);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    drawer.current?.querySelector<HTMLElement>("button,a")?.focus();
    document.addEventListener("keydown", handle);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", handle); };
  }, [mobileOpen]);

  const menuLinks = (mobile: boolean) => (
    <>
      <div className="platform-nav-group">Index</div>
      <nav className="platform-nav" aria-label={mobile ? "Mobile navigation" : "Main navigation"}>
        {nav.map(({ href, label, icon: Icon }, index) => (
          <Link key={href} href={href} className={`platform-nav-link ${active(href) ? "is-active" : ""} ${index === 4 ? "nav-section-start" : ""}`} aria-current={active(href) ? "page" : undefined}
            data-testid={href === "/gpus" ? (mobile ? "link-mobile-catalog" : "link-header-catalog") : undefined} onClick={() => setMobileOpen(false)}>
            <Icon size={16} strokeWidth={2} /><span>{label}</span>
          </Link>
        ))}
      </nav>
      
      <div className="platform-nav-group resource-label">Appendix</div>
      <nav className="platform-nav" aria-label="Resources">
        <a href="/docs/" className="platform-nav-link" onClick={mobile ? () => setMobileOpen(false) : undefined}>
          <BookOpen size={16} strokeWidth={2} />
          <span>Documentation</span>
          <ArrowUpRight size={14} className="ml-auto opacity-50" />
        </a>
      </nav>
      
      {mobile && (
        <div className="platform-mobile-actions">
          {!connected && !isSignedIn && (
            <Link href="/sign-in" data-testid="link-mobile-sign-in" className="platform-secondary" onClick={() => setMobileOpen(false)}>Sign in</Link>
          )}
          <ConnectWalletButton className="platform-secondary" />
        </div>
      )}
      
      <div className="platform-sidebar-bottom">
        <div className="sidebar-help">
          <strong>Quickstart Guide</strong>
          <p>Your reference for hardware, payments, and SSH connection protocols.</p>
          <a href="/docs/gpu-marketplace" onClick={mobile ? () => setMobileOpen(false) : undefined}>Read the manual <ArrowUpRight size={14} /></a>
        </div>
        <div className="sidebar-legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/cookies">Cookies</Link>
        </div>
      </div>
    </>
  );

  return (
    <div className="platform">
      <a className="platform-skip" href="#platform-main">Skip to content</a>
      <aside className="platform-sidebar">
        <Link href="/" className="platform-brand">
          <img src={`${import.meta.env.BASE_URL}cookie-run-mark-transparent.png`} alt="" />
          <span>Cookie Run</span>
        </Link>
        {menuLinks(false)}
      </aside>
      
      <div className="platform-stage">
        <header className="platform-topbar">
          <div className="platform-topbar-left">
            <button ref={toggle} data-testid="button-mobile-menu" className="platform-menu-button" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="platform-mobile-nav" onClick={() => setMobileOpen(!mobileOpen)}>
              <Menu size={20} />
            </button>
            <Link href="/" className="platform-mobile-brand">
              <img src={`${import.meta.env.BASE_URL}cookie-run-mark-transparent.png`} alt="Cookie Run" />
              <span>Cookie Run</span>
            </Link>
            <span className="platform-crumb-root hidden sm:inline">Platform</span>
            <ChevronRight size={14} className="platform-crumb-chevron hidden sm:inline" />
            <span className="platform-crumb-current">{current}</span>
          </div>
          
          <div className="platform-topbar-actions">
            {!connected && !isSignedIn && (
              <Link href="/sign-in" data-testid="link-header-sign-in" className="platform-sign-in">Sign in</Link>
            )}
            <div className="platform-desktop-wallet"><ConnectWalletButton className="platform-secondary" /></div>
            {isAuthed && <button className="platform-wallet-logout" onClick={signOut}>Sign out wallet</button>}
          </div>
        </header>
        
        {mobileOpen && (
          <div className="platform-mobile-layer" data-testid="mobile-menu">
            <button aria-label="Close navigation" className="platform-nav-backdrop" onClick={() => setMobileOpen(false)} />
            <aside ref={drawer} className="platform-mobile-drawer" id="platform-mobile-nav" role="dialog" aria-modal="true" aria-label="Navigation">
              <div className="platform-drawer-heading">
                <Link href="/" className="platform-brand">
                  <img src={`${import.meta.env.BASE_URL}cookie-run-mark-transparent.png`} alt="" />
                  <span>Cookie Run</span>
                </Link>
                <button className="platform-menu-close" onClick={() => { setMobileOpen(false); toggle.current?.focus(); }} aria-label="Close navigation">
                  <X size={24} strokeWidth={1.5} />
                </button>
              </div>
              {menuLinks(true)}
            </aside>
          </div>
        )}
        
        <main className="platform-main" id="platform-main" inert={mobileOpen ? true : undefined} aria-hidden={mobileOpen ? true : undefined}>
          {children}
        </main>
      </div>
    </div>
  );
}