import { AppShell } from "@/components/AppShell";

export default function Cookies() {
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-6 py-24 text-foreground md:px-12 w-full">
        <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mt-16 mb-5">Legal</div>
        <h1 className="tracking-tight text-5xl font-bold md:text-6xl">Cookie policy</h1>
        <p className="mt-6 text-sm text-muted-foreground">Last updated: 21 August 2026</p>

        <div className="mt-14 space-y-10 text-base leading-relaxed text-muted-foreground">
          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground tracking-tight">Current cookie use</h2>
            <p>
              The Cookie Run website does not currently load advertising,
              profiling, or third-party analytics cookies. Essential browser
              storage may be used for core functionality, security, wallet
              session behavior, and remembering your privacy choice.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground tracking-tight">Optional technologies</h2>
            <p>
              Optional analytics or marketing technologies will not be loaded
              unless you give a separate affirmative choice. The consent banner
              provides equal “Accept” and “Reject” paths and lets you change
              optional choices. If optional tools are introduced, this policy
              will identify each provider, purpose, duration, and international
              transfer before deployment.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground tracking-tight">Managing your choice</h2>
            <p>
              You can clear this site’s stored data in your browser settings to
              see the consent prompt again. A monitored privacy contact will be
              published before launch.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
