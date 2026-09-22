import { useState, useEffect, useCallback } from "react";
import { Router, Route, Switch, Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import Intro from "./pages/Intro";
import GpuMarketplace from "./pages/GpuMarketplace";
import Rewards from "./pages/Rewards";
import Staking from "./pages/Staking";
import MyRentals from "./pages/MyRentals";
import NotFound from "./pages/not-found";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const NAV = [
  {
    section: "Getting Started",
    links: [
      { path: "/", label: "What is Cookie Run?" },
    ],
  },
  {
    section: "Workspaces",
    links: [
      { path: "/gpu-marketplace", label: "Workspace lifecycle" },
      { path: "/my-workspaces", label: "SSH access" },
    ],
  },
  {
    section: "Platform",
    links: [
      { path: "/rewards", label: "Rewards" },
      { path: "/staking", label: "Integration workflows" },
    ],
  },
];

const NAV_ALIASES: Record<string, string[]> = {
  "/my-workspaces": ["/my-rentals"],
  "/rewards": ["/earn-icpx"],
};

function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [loc] = useLocation();

  // Close sidebar on route change on mobile
  useEffect(() => {
    onClose();
  }, [loc, onClose]);

  return (
    <>
      <div className={`mobile-overlay ${isOpen ? "open" : ""}`} onClick={onClose} />
      <aside id="docs-sidebar" className={`sidebar ${isOpen ? "open" : ""}`}>
        <div className="sidebar-logo">
          <Link href="/" className="wordmark">
            <img src={`${import.meta.env.BASE_URL}forgerun-mark.png`} width="44" height="44" alt="" />
            Cookie Run
            <span className="wordmark-badge">DOCS</span>
          </Link>
        </div>
        {NAV.map((group) => (
          <div className="sidebar-section" key={group.section}>
            <div className="sidebar-section-label">{group.section}</div>
            {group.links.map((l) => {
              const isActive =
                loc === l.path ||
                (l.path !== "/" && loc.startsWith(l.path)) ||
                NAV_ALIASES[l.path]?.some((path) => loc === path || loc.startsWith(`${path}/`));
              return (
                <Link
                  key={l.path}
                  href={l.path}
                  className={`sidebar-link${isActive ? " active" : ""}`}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        ))}
        <div className="sidebar-footer">
          {/* Footer content can go here if needed */}
        </div>
      </aside>
    </>
  );
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loc] = useLocation();
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Scroll to top on route change
  useEffect(() => {
    const el = document.querySelector('.content-area');
    if (el) el.scrollTo(0, 0);
  }, [loc]);

  return (
    <Router base={BASE}>
      <div className="docs-shell">
        <header className="mobile-header">
          <Link href="/" className="wordmark"><img src={`${import.meta.env.BASE_URL}forgerun-mark.png`} width="40" height="40" alt="" />Cookie Run docs</Link>
          <button 
            className="mobile-menu-btn" 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle menu"
            aria-expanded={sidebarOpen}
            aria-controls="docs-sidebar"
          >
            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </header>
        
        <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />
        
        <main className="content-area">
          <div className="content-inner" key={loc}>
            <Switch>
              <Route path="/" component={Intro} />
              <Route path="/gpu-marketplace" component={GpuMarketplace} />
              <Route path="/my-workspaces" component={MyRentals} />
              <Route path="/my-rentals" component={MyRentals} />
              <Route path="/rewards" component={Rewards} />
              <Route path="/earn-icpx" component={Rewards} />
              <Route path="/staking" component={Staking} />
              <Route component={NotFound} />
            </Switch>
          </div>
        </main>
      </div>
    </Router>
  );
}

export default App;
