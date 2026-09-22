import React from 'react';
import { Network } from 'lucide-react';

export default function ChainAnnouncement() {
  return (
    <section className="dark-region py-24 lg:py-32 px-6 lg:px-12 relative overflow-hidden bg-ink text-ink-foreground border-y border-ink-border">
      <div className="absolute inset-0 z-0 opacity-30 dark-grid pointer-events-none"></div>
      
      <div className="max-w-[1500px] mx-auto relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-24 items-center">
        <div className="lg:col-span-7">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-primary/30 bg-primary/10 text-primary text-[11px] uppercase tracking-wider font-mono mb-8">
             <Network size={14} /> Cookie Chain Settlement
          </div>
          
          <h2 className="text-4xl sm:text-5xl lg:text-[4rem] font-medium tracking-tight leading-[1.05] mb-8 text-balance">
             Deploying on <br/><span className="text-white">Cookie Chain.</span>
          </h2>
          
          <p className="text-ink-muted text-lg leading-relaxed mb-10 max-w-xl font-sans">
             Cookie Run uses Cookie Chain for precise, upfront payment settlement. No recurring subscriptions. No surprise bills. You receive a guaranteed COOK quote before your instance is provisioned.
          </p>
          
          <div className="flex flex-col gap-3 max-w-md bg-ink-border/20 p-2 rounded backdrop-blur-sm border border-ink-border">
            <div className="flex items-center justify-between p-4 bg-ink border border-ink-border/50 rounded-sm">
               <span className="text-[13px] font-mono text-ink-muted">Settlement Network</span>
                <span className="text-[13px] font-medium text-white">Cookie Chain (SVM)</span>
            </div>
            <div className="flex items-center justify-between p-4 bg-ink border border-ink-border/50 rounded-sm">
               <span className="text-[13px] font-mono text-ink-muted">Pricing Model</span>
               <span className="text-[13px] font-medium text-white">Fixed Hourly / Upfront</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
            <div className="p-4 border border-primary/50 bg-primary/10 rounded-sm">
              <p className="text-[10px] uppercase tracking-widest font-mono text-primary mb-2">
                Active checkout
              </p>
              <p className="text-[13px] text-white">
                Native COOK payments on Cookie Chain.
              </p>
            </div>
            <div className="p-4 border border-ink-border/50 bg-ink/60 rounded-sm">
              <p className="text-[10px] uppercase tracking-widest font-mono text-ink-muted mb-2">
                Compatibility
              </p>
              <p className="text-[13px] text-white">
                Historical EVM and Solana records remain supported.
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
            {[
              ["Wallet", "Nightly connection support"],
              ["Payments", "Native COOK transactions"],
              ["Feedback", "Confirmation and error states"],
              ["Ecosystem", "Cookie Chain integration-ready"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="p-4 border border-ink-border/50 bg-ink/60 rounded-sm"
              >
                <p className="text-[10px] uppercase tracking-widest font-mono text-primary mb-2">
                  {label}
                </p>
                <p className="text-[13px] text-white">{value}</p>
              </div>
            ))}
          </div>

          <p className="mt-8 text-sm text-ink-muted leading-relaxed max-w-xl">
            Cookie Run is built for Cookie Chain developers. Optional ecosystem
            integrations such as Cookiebox, Cookieswap, Cookie DAS, CookieScan,
            and cookie-mcp can be added where they fit the workflow.
          </p>
          
          <div className="mt-12 pt-8 border-t border-ink-border/40">
             <p className="text-[10px] text-ink-muted max-w-xl leading-relaxed uppercase tracking-wider font-mono">
                Notice: Cookie Run is an independent infrastructure provider. Cookie Chain checkout requires an operator-configured payment wallet and COOK price reference before it can accept payments.
             </p>
          </div>
        </div>
        
        <div className="lg:col-span-5 relative flex items-center justify-center">
           <div className="absolute inset-0 bg-gradient-to-tr from-ink via-transparent to-transparent z-10 pointer-events-none"></div>
           <div className="relative w-full max-w-[500px] aspect-square flex items-center justify-center">
               <div className="absolute inset-0 border border-ink-border/50 rounded-full animate-[spin_60s_linear_infinite]"></div>
               <div className="absolute inset-8 border border-ink-border/30 rounded-full animate-[spin_40s_linear_infinite_reverse]"></div>
               <img 
                 src={`${import.meta.env.BASE_URL}forgerun-infrastructure.png`} 
                 alt="Infrastructure diagram" 
                 className="w-[80%] h-auto mix-blend-screen opacity-70 filter grayscale contrast-125 relative z-20" 
               />
           </div>
        </div>
      </div>
    </section>
  );
}