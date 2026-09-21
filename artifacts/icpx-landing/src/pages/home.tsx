import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Search, Server, Activity, AlertCircle, RefreshCw, ChevronRight, Terminal, CreditCard, Shield, Cpu } from "lucide-react";
import { useIcpx } from "@/lib/icpx";
import { getGetGpuCatalogQueryKey, useGetGpuCatalog } from "@workspace/api-client-react";
import { AppShell } from "@/components/AppShell";

export default function Home() {
    const { openRent } = useIcpx();
    const [search, setSearch] = useState("");
    const [availableOnly, setAvailableOnly] = useState(false);
    const [sort, setSort] = useState("price");

    const { data: catalog, isLoading, isError, refetch } = useGetGpuCatalog({
        query: {
            refetchInterval: 60_000,
            staleTime: 30_000,
            queryKey: getGetGpuCatalogQueryKey(),
        },
    });

    const filteredGpus = useMemo(() => {
        if (!catalog?.gpus) return [];
        const s = search.trim().toLowerCase();
        return catalog.gpus.filter((g) => g.model.toLowerCase().includes(s) && (!availableOnly || g.available > 0))
          .sort((a, b) => sort === "memory" ? (b.gpuRamGb ?? 0) - (a.gpuRamGb ?? 0) : a.fromUsdHr - b.fromUsdHr);
    }, [catalog, search, availableOnly, sort]);
    return (
        <AppShell>
        <div className="min-h-full text-foreground font-sans pb-16">
            <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-7 flex flex-col xl:flex-row gap-6">
                
                {/* Main Content Column */}
                <div className="flex-1 min-w-0 space-y-6">
                    {/* Compact Intro */}
                    <section data-testid="section-hero" className="pb-4 flex flex-col justify-between items-start gap-4 border-b border-border">
                        <div className="flex items-center gap-3">
                            <span className="bg-foreground text-background font-mono text-[10px] uppercase tracking-widest px-2 py-1">System Overview</span>
                        </div>
                        <div>
                            <h1 className="text-4xl font-bold tracking-tight text-foreground mb-3 uppercase">
                                Developer overview
                            </h1>
                            <p className="text-muted-foreground text-[15px] leading-relaxed max-w-2xl">
                                 Intelligent execution. Streamlined workflows.<br />Choose a machine for a one-hour session, review a real-time native COOK quote on Cookie Chain, and connect over SSH.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 shrink-0 mt-2">
                            <a data-testid="link-hero-documentation" href="/docs/" className="text-[13px] font-mono uppercase font-semibold text-foreground px-4 py-2.5 border border-border hover:bg-secondary transition-colors">
                                Documentation
                            </a>
                            <button data-testid="button-hero-provision" onClick={() => openRent()} className="bg-foreground hover:bg-transparent hover:text-foreground border border-foreground text-background text-[13px] font-mono uppercase font-semibold px-4 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2">
                                New Workspace
                            </button>
                        </div>
                    </section>

                    {/* Catalog Table */}
                    <section data-testid="section-machine" className="bg-background border border-border flex flex-col">
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-secondary">
                            <div>
                                <h2 className="text-[13px] font-mono font-bold tracking-widest uppercase text-foreground">[ MACHINE CATALOG ]</h2>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
                                <div className="relative w-full sm:w-64 min-w-0 border border-border bg-background">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Search className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Search inventory..."
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="block w-full pl-9 pr-3 py-2 text-[13px] border-none focus:ring-1 focus:ring-foreground bg-transparent placeholder-muted-foreground"
                                    />
                                </div>
                                <select 
                                    value={sort}
                                    onChange={(e) => setSort(e.target.value)}
                                    className="border border-border bg-background text-[13px] py-2 pl-3 pr-8 focus:ring-1 focus:ring-foreground appearance-none"
                                >
                                    <option value="price">Sort by Price</option>
                                    <option value="memory">Sort by VRAM</option>
                                </select>
                            </div>
                        </div>

                        {/* Grid/Table Area */}
                        <div data-testid="catalog-grid" className="overflow-x-auto">
                            <table className="w-full text-left text-[14px] whitespace-nowrap">
                                <thead className="bg-background border-b border-border text-muted-foreground text-[11px] font-mono uppercase tracking-widest">
                                    <tr>
                                        <th className="px-5 py-3 first:pl-5 last:pr-5">Model</th>
                                        <th className="px-5 py-3">VRAM</th>
                                        <th className="px-5 py-3">Status</th>
                                        <th className="px-5 py-3">Regions</th>
                                        <th className="px-5 py-3 text-right">Rate / hour</th>
                                        <th className="px-5 py-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {isError && (
                                        <tr>
                                            <td colSpan={6} className="px-5 py-12 text-center">
                                                <div className="flex flex-col items-center justify-center">
                                                    <AlertCircle className="text-foreground mb-3" size={24} />
                                                    <p className="text-foreground font-mono font-bold text-[14px] uppercase tracking-wider mb-2">Catalog Unavailable</p>
                                                    <p className="text-muted-foreground text-[13px] mb-4">Could not fetch machine inventory from the network.</p>
                                                    <button onClick={() => refetch()} className="bg-background border border-foreground text-foreground hover:bg-foreground hover:text-background px-4 py-2 text-[11px] font-mono uppercase font-bold transition-colors inline-flex items-center gap-2">
                                                        <RefreshCw size={14} /> Retry Connection
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    
                                    {isLoading && !isError && (
                                        Array.from({ length: 6 }).map((_, i) => (
                                            <tr key={`loading-${i}`} className="animate-pulse bg-background">
                                                <td className="px-5 py-4"><div className="h-4 bg-border w-24"></div></td>
                                                <td className="px-5 py-4"><div className="h-4 bg-border w-12"></div></td>
                                                <td className="px-5 py-4"><div className="h-4 bg-border w-20"></div></td>
                                                <td className="px-5 py-4"><div className="h-4 bg-border w-16"></div></td>
                                                <td className="px-5 py-4 flex justify-end"><div className="h-4 bg-border w-12"></div></td>
                                                <td className="px-5 py-4 text-right"><div className="h-7 bg-border w-16 inline-block"></div></td>
                                            </tr>
                                        ))
                                    )}
                                    
                                    {!isLoading && !isError && filteredGpus.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-5 py-12 text-center">
                                                <div className="flex flex-col items-center justify-center">
                                                    <Search className="text-muted-foreground mb-3 opacity-50" size={24} />
                                                    <p className="text-foreground font-bold text-[14px]">No match found</p>
                                                    <p className="text-muted-foreground text-[13px]">Adjust your search query</p>
                                                </div>
                                            </td>
                                        </tr>
                                    )}

                                    {!isLoading && !isError && filteredGpus.slice(0, 8).map((gpu, index) => {
                                        const modelId = gpu.model.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                                        return (
                                            <tr key={index} className="hover:bg-secondary/50 transition-colors">
                                                <td className="px-5 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 bg-secondary border border-border flex items-center justify-center shrink-0">
                                                            <Cpu className="text-foreground" size={16} />
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-[14px] text-foreground">{gpu.model}</div>
                                                            <div className="text-[12px] text-muted-foreground font-mono">NVIDIA</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <span className="inline-flex items-center px-2 py-0.5 border border-border bg-background text-[11px] font-mono font-bold text-foreground">
                                                        {gpu.gpuRamGb ?? '?'}GB
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3">
                                                    {gpu.available > 0 ? (
                                                        <div className="flex items-center gap-1.5 text-[12px] text-foreground font-medium">
                                                            <div className="w-1.5 h-1.5 bg-foreground"></div> {gpu.available} Host{gpu.available === 1 ? '' : 's'}
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                                                            <div className="w-1.5 h-1.5 bg-border"></div> None available
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-5 py-3">
                                                    <div className="flex gap-1 flex-wrap w-32">
                                                        {gpu.regions.slice(0, 2).map((r, i) => (
                                                            <span key={i} className="text-[10px] font-mono font-bold uppercase bg-secondary text-foreground px-1.5 py-0.5 border border-border">
                                                                {r}
                                                            </span>
                                                        ))}
                                                        {gpu.regions.length > 2 && (
                                                            <span className="text-[10px] font-mono font-bold uppercase bg-secondary text-foreground px-1.5 py-0.5 border border-border">
                                                                +{gpu.regions.length - 2}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-5 py-3 text-right">
                                                    <div className="text-[14px] font-bold text-foreground font-mono">
                                                        ${gpu.fromUsdHr.toFixed(3)}
                                                    </div>
                                                </td>
                                                <td className="px-5 py-3 text-right">
                                                    <button 
                                                        onClick={() => openRent(gpu.model)}
                                                        aria-label={`Rent ${gpu.model}`}
                                                        className="text-[11px] font-mono font-bold uppercase tracking-wider text-background bg-foreground hover:bg-background hover:text-foreground border border-foreground px-3 py-1.5 transition-colors"
                                                    >
                                                        Rent
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        
                        {!isLoading && !isError && filteredGpus.length > 8 && (
                            <div className="p-4 border-t border-border bg-background text-center">
                                <Link href="/gpus" className="text-[13px] font-mono uppercase font-bold text-foreground hover:underline underline-offset-4 flex items-center justify-center gap-1">
                                    View Full Catalog <ChevronRight size={14} />
                                </Link>
                            </div>
                        )}
                    </section>
                </div>

                {/* Sidebar Column */}
                <div className="w-full xl:w-[320px] flex flex-col gap-6 shrink-0">
                    
                    {/* Access / Security Box */}
                    <div className="bg-background border border-border p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <Shield className="text-foreground" size={18} />
                            <h3 className="text-[12px] font-mono font-bold text-foreground uppercase tracking-widest">Security Layer</h3>
                        </div>
                        <p className="text-[13px] text-muted-foreground leading-relaxed mb-4">
                            Your sessions are isolated. Connect over SSH with standard keys. Access ends explicitly upon lease termination.
                        </p>
                    </div>

                    {/* Quick Links */}
                    <div className="bg-background border border-border p-5">
                        <h3 className="text-[12px] font-mono font-bold text-foreground mb-4 uppercase tracking-widest">Resources</h3>
                        <nav className="space-y-1">
                            <Link href="/workspaces" className="flex items-center gap-2 text-[13px] text-foreground hover:bg-foreground hover:text-background px-3 py-2 border border-transparent hover:border-foreground group transition-colors">
                                <Terminal size={15} className="text-muted-foreground group-hover:text-background" /> 
                                <span className="font-mono font-bold uppercase tracking-wider text-[11px]">Active Workspaces</span>
                            </Link>
                            <Link href="/marketplace" className="flex items-center gap-2 text-[13px] text-foreground hover:bg-foreground hover:text-background px-3 py-2 border border-transparent hover:border-foreground group transition-colors">
                                <Server size={15} className="text-muted-foreground group-hover:text-background" /> 
                                <span className="font-mono font-bold uppercase tracking-wider text-[11px]">Model Marketplace</span>
                            </Link>
                            <Link href="/benchmarks" className="flex items-center gap-2 text-[13px] text-foreground hover:bg-foreground hover:text-background px-3 py-2 border border-transparent hover:border-foreground group transition-colors">
                                <Activity size={15} className="text-muted-foreground group-hover:text-background" /> 
                                <span className="font-mono font-bold uppercase tracking-wider text-[11px]">Hardware Benchmarks</span>
                            </Link>
                            <Link href="/rewards" className="flex items-center gap-2 text-[13px] text-foreground hover:bg-foreground hover:text-background px-3 py-2 border border-transparent hover:border-foreground group transition-colors">
                                <CreditCard size={15} className="text-muted-foreground group-hover:text-background" /> 
                                <span className="font-mono font-bold uppercase tracking-wider text-[11px]">Platform Rewards</span>
                            </Link>
                        </nav>
                    </div>

                    {/* Workflow / Rules */}
                    <div className="bg-background border border-border p-5">
                        <h3 className="text-[12px] font-mono font-bold text-foreground mb-4 uppercase tracking-widest">Protocol</h3>
                        <ul className="space-y-5 text-[13px] text-muted-foreground">
                            <li className="flex gap-3 items-start">
                                <div className="mt-0.5 w-6 h-6 bg-foreground text-background flex items-center justify-center shrink-0 font-mono font-bold text-[11px] border border-foreground">01</div>
                                 <p className="leading-relaxed"><strong className="text-foreground font-bold">Configure</strong> hardware specs, verify the COOK quote, execute via Cookie Chain.</p>
                            </li>
                            <li className="flex gap-3 items-start">
                                <div className="mt-0.5 w-6 h-6 bg-foreground text-background flex items-center justify-center shrink-0 font-mono font-bold text-[11px] border border-foreground">02</div>
                                <p className="leading-relaxed"><strong className="text-foreground font-bold">Interface</strong> using raw SSH, VS Code Remote, or standard IDE terminals.</p>
                            </li>
                            <li className="flex gap-3 items-start">
                                <div className="mt-0.5 w-6 h-6 bg-foreground text-background flex items-center justify-center shrink-0 font-mono font-bold text-[11px] border border-foreground">03</div>
                                <p className="leading-relaxed"><strong className="text-foreground font-bold">Terminate</strong> and export output before the 1-hour lease automatically expires.</p>
                            </li>
                        </ul>
                    </div>

                </div>
            </div>
          <footer className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap justify-between gap-3 text-[11px] font-mono uppercase tracking-widest text-muted-foreground border-t border-border pt-6 mt-6">
            <span data-testid="footer-year">© {new Date().getFullYear()} Cookie Run</span>
            <div className="flex gap-5"><Link href="/privacy" className="hover:text-foreground">Privacy</Link><Link href="/cookies" className="hover:text-foreground">Cookies</Link><a href="/docs/" className="hover:text-foreground">Docs</a></div>
          </footer>
        </div>
        </AppShell>
    );
}