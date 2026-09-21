import { AppShell } from "@/components/AppShell";

export default function Privacy() {
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-6 py-24 text-foreground md:px-12 w-full">
        <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mt-16 mb-5">Legal</div>
        <h1 className="tracking-tight text-5xl font-bold md:text-6xl">Privacy policy</h1>
        <p className="mt-6 text-sm text-muted-foreground">Last updated: 21 August 2026</p>

        <div className="mt-14 space-y-10 text-base leading-relaxed text-muted-foreground">
          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground tracking-tight">Who we are</h2>
            <p>
              Cookie Run operates a platform for ephemeral developer machines and isolated workspaces.
              The platform operator is the controller of personal data described
              in this policy. Before launch, the operator’s full legal name,
              registered address, and confirmed privacy contact must be added to
              this section.
            </p>
            <p className="mt-3">
              A monitored privacy contact and the operator’s legal details will
              be published here before launch. Please do not send sensitive
              personal information through an unverified channel.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground tracking-tight">Information we process</h2>
            <p>
              Depending on how you use the platform, this may include a wallet
              address and signed wallet messages, workspace and payment references,
              SSH public keys, optional receipt email addresses, support
              correspondence, and technical security logs. We do not ask for or
              store wallet seed phrases or private SSH keys.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground tracking-tight">Why we use it</h2>
            <p>
              We use information to authenticate wallet actions, quote and
              provision workspaces, verify on-chain payments, provide SSH access,
              send requested receipts or service messages, prevent abuse, and
              meet legal and accounting obligations. We do not sell personal
              information.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground tracking-tight">Legal bases and sharing</h2>
            <p>
              Depending on the processing, our legal bases may include
              performance of a contract, legitimate interests in security and
              service operation, consent for optional measurement, and
              compliance with legal obligations. We share only what is needed
              with infrastructure, hosting, email, GPU provisioning, wallet, and
              payment service providers. Providers act under appropriate
              contractual and security controls.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground tracking-tight">Retention and your rights</h2>
            <p>
              We retain information only as long as needed for the purposes
              above, including tax, fraud-prevention, dispute, and legal
              requirements. Depending on your location, you may have rights to
              access, correct, delete, restrict, object to, or export your
              information, and to withdraw consent. You may also complain to
              your local data-protection authority.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground tracking-tight">Updates</h2>
            <p>
              We may update this policy when the platform or legal requirements
              change. The date above identifies the current version.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
