import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  createWorkspace,
  confirmWorkspace,
  useAuthorizeSourceCredential,
  useGetPaymentConfig,
  useGetComputeTemplates,
  useGetGpuCatalog,
  getGetGpuCatalogQueryKey,
  getGetMyWorkspacesQueryKey,
  useValidateGitHubRepository,
  type Workspace,
  type SourceControlValidation,
} from "@workspace/api-client-react";
import { CheckCircle2, Cpu, Loader2, Copy, Check, AlertCircle, Shield, GitBranch, HardDrive, DollarSign, Wallet, RefreshCw, Key } from "lucide-react";
import Modal from "./Modal";
import { SectionBlock, GridOptions, InputRow, StatusPill } from "./RentModalUI";
import "./rent-modal.css";
import {
  buildEvmTransaction,
  checkEvmFunds,
  describeEvmPayError,
  type EvmPaymentQuote,
  formatEthDisplay,
  formatTokenDisplay,
  waitForEvmConfirmation,
} from "@/lib/evmPay";
import { useEvmWallet } from "@/lib/wallet";
import {
  getSourceValidationState,
  type SourceValidationState,
} from "@/lib/sourceValidationState";
const DEFAULT_MODEL = "H100";
const DURATIONS = [1, 2, 6, 12, 24, 72];

const INSTANCE_TYPES = [
  { id: "on-demand", label: "On-Demand", hint: "Dedicated" },
  { id: "spot", label: "Spot", hint: "−40% · may pause" },
  { id: "reserved", label: "Reserved", hint: "−15%" },
] as const;
const DISK_PRESETS = [0, 50, 100, 250, 500];
const INSTANCE_LABEL: Record<string, string> = {
  "on-demand": "On-Demand",
  spot: "Spot",
  reserved: "Reserved",
};

type Step = "config" | "quoting" | "quote" | "paying" | "confirming" | "confirm_failed" | "success";
type CredentialStatus =
  | "disconnected"
  | "oauth_required"
  | "permission_denied"
  | "expired"
  | "ready"
  | "error";

function shortKey(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}


type OsKey = "macOS" | "Linux" | "Windows";

// Per-OS instructions for generating and revealing an SSH public key. The
// generate step is identical everywhere (OpenSSH ships on modern macOS, Linux,
// and Windows 10/11); only the "print the key" command differs.
const SSH_GUIDES: Record<OsKey, { open: string; reveal: string }> = {
  macOS: { open: "Open Terminal", reveal: "cat ~/.ssh/id_ed25519.pub" },
  Linux: { open: "Open your terminal", reveal: "cat ~/.ssh/id_ed25519.pub" },
  Windows: {
    open: "Open PowerShell",
    reveal: "type $env:USERPROFILE\\.ssh\\id_ed25519.pub",
  },
};

const SSH_GENERATE = 'ssh-keygen -t ed25519 -C "you@email.com"';

// Loose check that the pasted value looks like an SSH *public* key line, so a
// workspace owner can't pay for an instance they have no way to connect to (or paste a
// private key by mistake).
function isValidSshKey(value: string): boolean {
  const v = value.trim();
  return /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/]+=*(?:\s.*)?$/.test(
    v,
  );
}

function isValidContainerImage(value: string): boolean {
  const image = value.trim();
  const digestParts = image.split("@");
  return (
    !image ||
    (image.length <= 255 &&
      !/[\s"'`\\;$&|<>()[\]{}]/.test(image) &&
      !image.includes("://") &&
      digestParts.length <= 2 &&
      (!digestParts[1] || /^sha256:[a-f0-9]{64}$/i.test(digestParts[1])) &&
      /^[a-z0-9][a-z0-9._:@/-]*$/i.test(image))
  );
}

function credentialStatusLabel(status: CredentialStatus): string {
  switch (status) {
    case "oauth_required":
      return "OAuth required";
    case "ready":
      return "Ready";
    case "permission_denied":
      return "Permission denied";
    case "expired":
      return "Expired";
    case "error":
      return "Check failed";
    default:
      return "Disconnected";
  }
}

// Best-effort default tab so most users see the right commands first.
function detectOs(): OsKey {
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent || "";
    if (/Windows|Win32|Win64/i.test(ua)) return "Windows";
    if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return "Linux";
  }
  return "macOS";
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard blocked — the user can still select the text manually */
        }
      }}
      aria-label="Copy command"
      data-testid="button-copy-ssh-cmd"
      className="shrink-0 px-2.5 flex items-center text-muted-foreground hover:text-primary transition-colors"
      style={{ borderLeft: "1px solid rgba(255,255,255,0.12)" }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function CommandRow({ cmd }: { cmd: string }) {
  return (
    <div
      className="flex items-stretch bg-background/60"
      style={{ border: "1px solid rgba(255,255,255,0.12)" }}
    >
      <code className="min-w-0 flex-1 font-mono text-[11px] text-primary/90 px-2.5 py-2 whitespace-pre-wrap break-all">
        {cmd}
      </code>
      <CopyButton value={cmd} />
    </div>
  );
}

// OS-tabbed walkthrough for getting an SSH public key.
function SshKeyHelp({ os, setOs }: { os: OsKey; setOs: (o: OsKey) => void }) {
  const guide = SSH_GUIDES[os];
  return (
    <div className="mt-2" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
      <div className="flex">
        {(Object.keys(SSH_GUIDES) as OsKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setOs(k)}
            data-testid={`tab-ssh-os-${k.toLowerCase()}`}
            className={cn("flex-1 font-mono text-[10px] tracking-widest uppercase py-2 transition-colors", os === k ? "text-primary" : "text-muted-foreground")}
          >
            {k}
          </button>
        ))}
      </div>
      <div
        className="p-3 space-y-3"
        style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
      >
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] text-muted-foreground/70">
            1 · No key yet? {guide.open} and generate one:
          </p>
          <CommandRow cmd={SSH_GENERATE} />
        </div>
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] text-muted-foreground/70">
            2 · Print your public key, then copy the whole line:
          </p>
          <CommandRow cmd={guide.reveal} />
        </div>
        <p className="font-mono text-[10px] text-muted-foreground/50 leading-relaxed">
          Paste the line starting with{" "}
          <span className="text-primary/70">ssh-ed25519</span> (or{" "}
          <span className="text-primary/70">ssh-rsa</span>) above. Never paste
          your private key.
        </p>
      </div>
    </div>
  );
}

export default function RentModal({
  open,
  initialModel,
  initialTemplateId,
  onClose,
}: {
  open: boolean;
  initialModel?: string;
  initialTemplateId?: string;
  onClose: () => void;
}) {
  const { address, connected, connect, provider, solanaProvider, sendTransactionOnNetwork } = useEvmWallet();
  const { data: paymentConfig } = useGetPaymentConfig();
  const evmPaymentConfig = paymentConfig as (typeof paymentConfig & {
    paymentReady?: boolean;
    solPaymentReady?: boolean;
    tokenReady?: boolean;
    tokenLockReason?: string | null;
    chainId?: number;
  }) | undefined;
  const paymentReady = evmPaymentConfig?.paymentReady === true;
  const solPaymentReady = evmPaymentConfig?.solPaymentReady === true;

  const queryClient = useQueryClient();
  const catalog = useGetGpuCatalog({ query: { queryKey: getGetGpuCatalogQueryKey(), enabled: open, staleTime: 30_000, refetchInterval: open ? 60_000 : false } });
  const [modelSearch, setModelSearch] = useState("");
  const [model, setModel] = useState(initialModel || DEFAULT_MODEL);
  const [hours, setHours] = useState(1);
  const [email, setEmail] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [sshOs, setSshOs] = useState<OsKey>(detectOs);
  const [currency, setCurrency] = useState<"COOK" | "SOL">("COOK");
  const { data: templates } = useGetComputeTemplates();
  const [templateId, setTemplateId] = useState<string>(
    initialTemplateId || "bare-gpu",
  );
  const [instanceType, setInstanceType] =
    useState<"on-demand" | "spot" | "reserved">("on-demand");
  const [extraDiskGb, setExtraDiskGb] = useState<number>(0);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryRevision, setRepositoryRevision] = useState("");
  const [agentTask, setAgentTask] = useState("");
  const [agentRunEnabled, setAgentRunEnabled] = useState(false);
  const [containerImage, setContainerImage] = useState("");
  const [githubCredentialRef, setGithubCredentialRef] = useState<string | null>(null);
  const [githubCredentialStatus, setGithubCredentialStatus] =
    useState<CredentialStatus>("oauth_required");
  const [githubCredentialMessage, setGithubCredentialMessage] = useState<string | null>(null);
  const [registryUsername, setRegistryUsername] = useState("");
  const [registryToken, setRegistryToken] = useState("");
  const [registryHost, setRegistryHost] = useState("");
  const [registryCredentialRef, setRegistryCredentialRef] = useState<string | null>(null);
  const [registryCredentialStatus, setRegistryCredentialStatus] =
    useState<CredentialStatus>("disconnected");
  const [registryCredentialMessage, setRegistryCredentialMessage] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] =
    useState<SourceValidationState>("not_connected");
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("config");
  const [rental, setRental] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signatureRef = useRef<string | null>(null);
  const sourceValidation = useValidateGitHubRepository();
  const credentialAuthorization = useAuthorizeSourceCredential();

  useEffect(() => {
    if (open) {
      setModel(initialModel || DEFAULT_MODEL);
      setModelSearch("");
      setTemplateId(initialTemplateId || "bare-gpu");
      setInstanceType("on-demand");
      setExtraDiskGb(0);
      setRepositoryUrl("");
      setRepositoryRevision("");
      setContainerImage("");
      setGithubCredentialRef(null);
       setGithubCredentialStatus("oauth_required");
      setGithubCredentialMessage(null);
      setRegistryUsername("");
      setRegistryToken("");
      setRegistryHost("");
      setRegistryCredentialRef(null);
      setRegistryCredentialStatus("disconnected");
      setRegistryCredentialMessage(null);
      setSourceStatus("not_connected");
      setSourceMessage(null);
      setStep("config");
       setCurrency("COOK");
      setRental(null);
      setError(null);
      signatureRef.current = null;
    }
  }, [open, initialModel, initialTemplateId]);

  function close() {
    onClose();
    setTimeout(() => {
      setStep("config");
       setCurrency("COOK");
      setRental(null);
      setError(null);
      setHours(1);
      setEmail("");
      setSshKey("");
      setTemplateId("bare-gpu");
      setInstanceType("on-demand");
      setExtraDiskGb(0);
      setRepositoryUrl("");
      setRepositoryRevision("");
      setContainerImage("");
      setGithubCredentialRef(null);
       setGithubCredentialStatus("oauth_required");
      setGithubCredentialMessage(null);
      setRegistryUsername("");
      setRegistryToken("");
      setRegistryHost("");
      setRegistryCredentialRef(null);
      setRegistryCredentialStatus("disconnected");
      setRegistryCredentialMessage(null);
      setSourceStatus("not_connected");
      setSourceMessage(null);
      signatureRef.current = null;
    }, 250);
  }

  async function checkRepository(): Promise<SourceControlValidation | null> {
    const url = repositoryUrl.trim();
    if (!url) {
      setSourceStatus("not_connected");
      setSourceMessage(null);
      return null;
    }
    setSourceStatus(
      getSourceValidationState({
        repositoryUrl: url,
        isPending: true,
      }),
    );
    setSourceMessage(null);
    try {
      const result = await sourceValidation.mutateAsync({
        data: {
          repositoryUrl: url,
          revision: repositoryRevision.trim() || undefined,
          credentialRef: githubCredentialRef ?? undefined,
        },
      });
      setSourceStatus(
        getSourceValidationState({
          repositoryUrl: url,
          isPending: false,
          validation: result,
        }),
      );
      setSourceMessage(result.message);
      if (result.status === "connected") {
        setRepositoryUrl(result.repositoryUrl ?? url);
        setRepositoryRevision(result.revision ?? "");
      }
      return result;
    } catch (e) {
      const message = describeEvmPayError(e);
      setSourceStatus(
        getSourceValidationState({
          repositoryUrl: url,
          isPending: false,
          failed: true,
        }),
      );
      setSourceMessage(message);
      return null;
    }
  }

  async function authorizeRegistry() {
    if (!registryUsername.trim() || !registryToken.trim()) {
      setRegistryCredentialStatus("error");
      setRegistryCredentialMessage("Enter the registry username and access token.");
      return;
    }
    setRegistryCredentialMessage(null);
    try {
      const result = await credentialAuthorization.mutateAsync({
        data: {
          provider: "registry",
          username: registryUsername.trim(),
          token: registryToken.trim(),
          registryHost: registryHost.trim() || undefined,
        },
      });
      setRegistryCredentialStatus(result.status);
      setRegistryCredentialMessage(result.message);
      setRegistryCredentialRef(result.credentialRef ?? null);
      if (result.status === "ready") setRegistryToken("");
    } catch (e) {
      setRegistryCredentialStatus("error");
      setRegistryCredentialMessage(describeEvmPayError(e));
      setRegistryCredentialRef(null);
    }
  }

  async function getQuote() {
     if ((currency === "COOK" || currency === "SOL") && !address) {
       setError("Connect Nightly Wallet before requesting a Cookie Chain quote.");
      return;
    }
    const wantsAgentRun = agentRunEnabled && agentTask.trim().length > 0;
    // An Agent Run supplies its own server-managed SSH access, so a pasted key
    // is optional (it only adds the renter's own terminal access alongside it).
    if (!wantsAgentRun && !isValidSshKey(sshKey)) {
       setError("Add your SSH public key above so you can connect to the machine.");
      return;
    }
    if (sshKey.trim() && !isValidSshKey(sshKey)) {
      setError("That doesn't look like a valid SSH public key.");
      return;
    }
    if (!isValidContainerImage(containerImage)) {
      setError("Enter a valid OCI container image reference.");
      return;
    }
    if (agentRunEnabled && !repositoryUrl.trim()) {
      setError("Add a public GitHub repository to use Agent Run.");
      return;
    }
    setStep("quoting");
    setError(null);
    try {
      const source = await checkRepository();
      if (repositoryUrl.trim() && source?.status !== "connected") {
        setError(
          source?.message ??
            "Verify the GitHub repository before requesting a workspace.",
        );
        setStep("config");
        return;
      }
       if (!(currency === "SOL" ? solPaymentReady : paymentReady)) {
         setError(`${currency} payments are not configured yet. Please try again shortly.`);
        setStep("config");
        return;
      }
      const r = await createWorkspace({
        gpuModel: model,
        durationHours: hours,
        templateId,
        repositoryUrl: repositoryUrl.trim() || undefined,
        repositoryRevision: repositoryRevision.trim() || undefined,
        githubCredentialRef: githubCredentialRef ?? undefined,
        containerImage: containerImage.trim() || undefined,
        registryCredentialRef: registryCredentialRef ?? undefined,
        instanceType,
        extraDiskGb,
        email: email.trim() || undefined,
        payerWallet: address ?? undefined,
        sshKey: sshKey.trim() || undefined,
        agentTask: wantsAgentRun ? agentTask.trim() : undefined,
        currency,
      });
      setRental(r);
      setStep("quote");
    } catch (e) {
      setError(describeEvmPayError(e));
      setStep("config");
    }
  }

  async function pay() {
    if (!rental || !address || !provider) return;
    setError(null);
    // Reuse an already-sent payment if a prior confirm failed, so retrying
    // confirmation never sends a second on-chain transfer.
    let sig = signatureRef.current;
    try {
       if (!(rental.currency === "SOL" ? solPaymentReady : paymentReady)) throw new Error(`${rental.currency} payments are not configured yet.`);
      if (!sig) {
         const tx = buildEvmTransaction(address, rental as Workspace & EvmPaymentQuote);
         const networkProvider = rental.currency === "SOL" ? solanaProvider : provider;
         if (!networkProvider) throw new Error("Payment network is unavailable.");
         const preflightError = await checkEvmFunds(networkProvider, tx, rental as Workspace & EvmPaymentQuote);
        if (preflightError) {
          setError(preflightError);
          setStep("quote");
          return;
        }

        setStep("paying");
         sig = await sendTransactionOnNetwork(tx, rental.currency === "SOL" ? "solana" : "cookie");
        signatureRef.current = sig;

        setStep("confirming");
        // Record the signature server-side the instant it broadcasts, so a paid
        // order is never orphaned if confirmation is slow or the tab closes.
        // Best-effort: the server stores it and returns 400 until the tx
        // confirms; we ignore that here and finalize after the wait below.
        void confirmWorkspace(rental.id, { signature: sig }).catch(() => {});
         await waitForEvmConfirmation(networkProvider, sig);
      }

      setStep("confirming");
      const confirmed = await confirmWorkspace(rental.id, { signature: sig });
      setRental(confirmed);
      void queryClient.invalidateQueries({ queryKey: getGetMyWorkspacesQueryKey() });
      setStep("success");
    } catch (e) {
      setError(describeEvmPayError(e));
      // If the transfer already went out, don't reset to the pay screen — offer
      // a confirmation retry that reuses the existing signature.
      setStep(sig ? "confirm_failed" : "quote");
    }
  }

  // Use the same live catalog as Machines, rather than a six-model shortlist.
  // Keep the selection visible even if capacity disappears between refreshes.
  const liveModels = catalog.data?.gpus ?? [];
  const modelOptions = [
    ...(!liveModels.some((gpu) => gpu.model === model)
      ? [{ id: model, label: model, hint: "Availability checked at quote" }]
      : []),
    ...liveModels.map((gpu) => ({
      id: gpu.model,
      label: gpu.model,
      hint: gpu.gpuRamGb != null ? `${gpu.gpuRamGb} GB VRAM` : undefined,
    })),
  ];
  const filteredModels = modelOptions.filter((gpu) => gpu.label.toLowerCase().includes(modelSearch.trim().toLowerCase()));
  const sshValid = isValidSshKey(sshKey);
  const selectedTemplate = templates?.find((t) => t.id === templateId);
  const rentalTemplate = rental
    ? templates?.find((t) => t.id === rental.templateId)
    : undefined;

  return (
    <Modal open={open} onClose={close} title="PROVISION WORKSPACE" maxWidth={1200}>
      <div className="provision-shell pb-6">
      {(step === "config" || step === "quoting") && (
        <div className="provision-layout">
          <div className="min-w-0 space-y-6">
            <SectionBlock title="COMPUTE">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="mono-label">Hardware</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{liveModels.length} live models</span>
                </div>
                <input type="search" aria-label="Search hardware models" placeholder="Search all GPU models…" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} className="input-field w-full font-mono text-[12px] px-3 py-3 mb-3" data-testid="input-search-rent-model" />
                {catalog.isLoading && <p role="status" className="font-mono text-xs mb-3">Loading live hardware…</p>}
                {catalog.isError && (
                  <div role="alert" className="font-mono text-xs mb-3">
                    Could not refresh hardware availability. <button type="button" className="underline" onClick={() => void catalog.refetch()}>Retry</button>
                  </div>
                )}
                <div className="provision-model-list">
                  <GridOptions options={filteredModels} value={model} onChange={setModel} columns={3} testIdPrefix="option-model" />
                  {!filteredModels.length && <p className="font-mono text-xs p-3">No matching models. Try another search.</p>}
                </div>
                <p className="font-mono text-[11px] mt-3">Selected: <strong>{model}</strong></p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="mono-label">Instance Type</span>
                </div>
                <GridOptions
                  options={INSTANCE_TYPES.map(t => ({ id: t.id, label: t.label, hint: t.hint }))}
                  value={instanceType}
                  onChange={(id) => setInstanceType(id as any)}
                  columns={3}
                  testIdPrefix="option-instance"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="mono-label">Duration</span>
                  </div>
                  <GridOptions
                    options={DURATIONS.map((h) => ({ id: h, label: `${h} HR` }))}
                    value={hours}
                    onChange={(id) => setHours(id as number)}
                    columns={2}
                    testIdPrefix="option-hours"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="mono-label">Extra Storage</span>
                  </div>
                  <GridOptions
                    options={DISK_PRESETS.map((g) => ({ id: g, label: g === 0 ? "NONE" : `+${g} GB` }))}
                    value={extraDiskGb}
                    onChange={setExtraDiskGb}
                    columns={2}
                    testIdPrefix="option-disk"
                  />
                  {selectedTemplate && (
                    <p className="font-mono text-[9px] text-muted-foreground mt-2">
                      {selectedTemplate.defaultDiskGb} GB included
                      {extraDiskGb > 0 ? ` · ${selectedTemplate.defaultDiskGb + extraDiskGb} GB total` : ""}
                    </p>
                  )}
                </div>
              </div>
            </SectionBlock>

            <SectionBlock title="ENVIRONMENT" subtitle={templates ? undefined : "LOADING..."}>
              <div>
                 <div className="flex items-center justify-between mb-2">
                  <span className="mono-label">Workload Template</span>
                </div>
                {templates ? (
                  <GridOptions
                    options={templates.map((t) => ({ id: t.id, label: t.name, hint: t.category }))}
                    value={templateId}
                    onChange={setTemplateId}
                    columns={2}
                    testIdPrefix="option-template"
                  />
                ) : (
                  <div className="h-20 flex items-center justify-center border border-border">
                     <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {selectedTemplate && (
                  <p className="font-mono text-[11px] text-muted-foreground mt-3 border-l-2 border-border pl-3">
                    {selectedTemplate.description}
                  </p>
                )}
              </div>

              <div className="space-y-4 pt-4 mt-4 border-t border-border">
                 <div className="flex items-center justify-between">
                  <span className="mono-label flex items-center gap-1.5 text-foreground"><GitBranch className="h-3 w-3" /> Source Code</span>
                  <StatusPill 
                    status={sourceStatus} 
                    testId="text-source-status"
                    labels={{
                      not_connected: { text: "Not connected", variant: "default" },
                      loading: { text: "Checking…", variant: "default" },
                      connected: { text: "Connected", variant: "success" },
                      permission_required: { text: "Permission required", variant: "error" },
                      expired: { text: "Expired", variant: "error" },
                      error: { text: "Check failed", variant: "error" }
                    }}
                  />
                </div>
                
                <div className="provision-source-fields">
                  <input
                    type="url"
                    value={repositoryUrl}
                    onChange={(e) => {
                      setRepositoryUrl(e.target.value);
                      setSourceStatus(e.target.value.trim() ? "not_connected" : "not_connected");
                      setSourceMessage(null);
                    }}
                    placeholder="https://github.com/owner/repo"
                    data-testid="input-rent-repository"
                    className="input-field flex-1 font-mono text-[12px] px-3 py-2 min-w-0"
                  />
                  <input
                    type="text"
                    value={repositoryRevision}
                    onChange={(e) => {
                      setRepositoryRevision(e.target.value);
                      setSourceStatus("not_connected");
                      setSourceMessage(null);
                    }}
                    placeholder="Revision"
                    data-testid="input-rent-revision"
                    className="input-field w-24 font-mono text-[12px] px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={() => void checkRepository()}
                    disabled={!repositoryUrl.trim() || sourceValidation.isPending}
                    data-testid="button-check-repository"
                    className="btn-ghost font-mono text-[10px] uppercase px-4 disabled:opacity-40 flex items-center justify-center min-w-[80px]"
                  >
                    {sourceValidation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Check"}
                  </button>
                </div>
                
                {(sourceMessage || sourceStatus === "permission_required") && (
                  <p className={cn("font-mono text-[10px] flex items-start gap-1.5", sourceStatus === "connected" ? "text-primary" : "text-destructive")}>
                    {sourceStatus !== "connected" && <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />}
                    <span>{sourceMessage || "Cookie Run checks the repository server-side and checks out the selected revision after payment."}</span>
                  </p>
                )}

                <div className="mt-4 pt-4 border-t border-border">
                  <div className="grid grid-cols-3 gap-2 mb-4" data-testid="source-access-policy">
                    <div className="p-2 border border-border bg-muted/20">
                      <div className="font-mono text-[9px] tracking-widest uppercase text-foreground">Public Git</div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-1">Check now</div>
                    </div>
                    <div className="p-2 border border-border bg-muted/20">
                      <div className="font-mono text-[9px] tracking-widest uppercase text-foreground">Private Git</div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-1">OAuth required</div>
                    </div>
                    <div className="p-2 border border-border bg-muted/20">
                      <div className="font-mono text-[9px] tracking-widest uppercase text-foreground">Private OCI</div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-1">Registry access</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="mono-label">Private GitHub access</div>
                    <span 
                      data-testid="text-github-credential-status" 
                      className={cn(
                        "font-mono text-[9px] tracking-widest uppercase",
                        githubCredentialStatus === "ready" ? "text-primary" : githubCredentialStatus === "oauth_required" ? "text-muted-foreground" : "text-destructive"
                      )}
                    >
                      {credentialStatusLabel(githubCredentialStatus)}
                    </span>
                  </div>
                  
                  <div className="p-3 mt-2 border border-border bg-muted/20 space-y-2" data-testid="panel-github-oauth-required">
                    <div className="flex items-start gap-2">
                      <Shield className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <p className="font-mono text-[10px] text-foreground leading-relaxed">
                        Private repositories require a connected GitHub provider OAuth account. Cookie Run does not accept personal access tokens in checkout.
                      </p>
                    </div>
                    <p className="font-mono text-[10px] text-muted-foreground leading-relaxed pl-5">
                      Public repositories can be checked now. Connect GitHub before requesting a workspace that needs private source access.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-4 mt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <label className="mono-label flex items-center gap-1.5 text-foreground cursor-pointer" htmlFor="agent-run-toggle">
                    <Cpu className="h-3 w-3" /> Agent Run
                  </label>
                  <button
                    id="agent-run-toggle"
                    type="button"
                    onClick={() => setAgentRunEnabled((v) => !v)}
                    data-testid="button-toggle-agent-run"
                    className={cn(
                      "font-mono text-[9px] tracking-widest uppercase px-3 py-1 border",
                      agentRunEnabled
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {agentRunEnabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
                {agentRunEnabled && (
                  <div className="space-y-2">
                    <textarea
                      value={agentTask}
                      onChange={(e) => setAgentTask(e.target.value)}
                      placeholder="Describe what the agent should do in this repository, e.g. add unit tests for the checkout flow."
                      data-testid="input-agent-task"
                      rows={3}
                      maxLength={4000}
                      className="input-field w-full font-mono text-[12px] px-3 py-2 resize-none"
                    />
                    <p className="font-mono text-[10px] text-muted-foreground leading-relaxed">
                      Requires a public GitHub repository above. The agent works inside this workspace and produces a diff for you to review — it never commits or pushes on its own.
                    </p>
                    {!repositoryUrl.trim() && (
                      <p className="font-mono text-[10px] text-destructive flex items-center gap-1.5" data-testid="text-agent-run-needs-repo">
                        <AlertCircle className="h-3 w-3 shrink-0" /> Add a public repository above to enable Agent Run.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-4 pt-4 mt-4 border-t border-border">
                 <div className="flex items-center justify-between">
                  <span className="mono-label flex items-center gap-1.5 text-foreground"><HardDrive className="h-3 w-3" /> Container Image</span>
                  <StatusPill 
                    status={registryCredentialStatus}
                    testId="text-registry-credential-status"
                    labels={{
                      disconnected: { text: "Public / No Auth", variant: "default" },
                      ready: { text: "Auth Ready", variant: "success" },
                      permission_denied: { text: "Denied", variant: "error" },
                      expired: { text: "Expired", variant: "error" },
                      error: { text: "Error", variant: "error" }
                    }}
                  />
                </div>
                
                <div>
                  <input
                    type="text"
                    value={containerImage}
                    onChange={(e) => setContainerImage(e.target.value)}
                    placeholder="python:3.12-slim or ghcr.io/owner/tool:latest"
                    data-testid="input-rent-container-image"
                    className={cn(
                      "input-field w-full font-mono text-[12px] px-3 py-2",
                      containerImage.trim() && !isValidContainerImage(containerImage) && "border-destructive text-destructive"
                    )}
                  />
                  {containerImage.trim() && !isValidContainerImage(containerImage) && (
                    <p
                      className="font-mono text-[10px] text-destructive mt-1.5"
                      data-testid="text-container-image-invalid"
                    >
                      Use an OCI reference such as python:3.12-slim or ghcr.io/owner/tool:latest.
                    </p>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-2 mt-2">
                   <input
                    type="text"
                    value={registryUsername}
                    onChange={(e) => {
                      setRegistryUsername(e.target.value);
                      setRegistryCredentialRef(null);
                      setRegistryCredentialStatus("disconnected");
                    }}
                    placeholder="Registry Username"
                    data-testid="input-rent-registry-username"
                    className="input-field font-mono text-[12px] px-3 py-2"
                  />
                  <input
                    type="text"
                    value={registryHost}
                    onChange={(e) => {
                      setRegistryHost(e.target.value);
                      setRegistryCredentialRef(null);
                      setRegistryCredentialStatus("disconnected");
                    }}
                    placeholder="Registry Host"
                    data-testid="input-rent-registry-host"
                    className="input-field font-mono text-[12px] px-3 py-2"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={registryToken}
                    onChange={(e) => {
                      setRegistryToken(e.target.value);
                      setRegistryCredentialRef(null);
                      setRegistryCredentialStatus("disconnected");
                    }}
                    placeholder="Access Token"
                    data-testid="input-rent-registry-token"
                    className="input-field flex-1 font-mono text-[12px] px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={() => void authorizeRegistry()}
                    disabled={!registryUsername.trim() || !registryToken.trim() || credentialAuthorization.isPending}
                    data-testid="button-authorize-registry"
                    className="btn-ghost font-mono text-[10px] uppercase px-4 disabled:opacity-40 min-w-[80px] flex items-center justify-center"
                  >
                    {credentialAuthorization.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" /> : "Auth"}
                  </button>
                </div>
                {registryCredentialMessage && (
                  <p className={cn("font-mono text-[10px]", registryCredentialStatus === "ready" ? "text-primary" : "text-destructive")}>
                    {registryCredentialMessage}
                  </p>
                )}
              </div>
            </SectionBlock>
          </div>

          <div className="provision-sidebar min-w-0 space-y-6">
            <SectionBlock title="ACCESS">
              <div className="space-y-4">
                <div>
                   <div className="flex items-center justify-between mb-2">
                    <span className="mono-label text-foreground flex items-center gap-1.5"><Key className="h-3 w-3" /> SSH Key</span>
                    <span className={cn("font-mono text-[9px] uppercase", agentRunEnabled && agentTask.trim() ? "text-muted-foreground" : "text-destructive")}>
                      {agentRunEnabled && agentTask.trim() ? "Optional" : "Required"}
                    </span>
                  </div>
                  <textarea
                    value={sshKey}
                    onChange={(e) => setSshKey(e.target.value)}
                    placeholder={agentRunEnabled && agentTask.trim() ? "ssh-ed25519 AAAA... (optional — for your own terminal access)" : "ssh-ed25519 AAAA..."}
                    rows={3}
                    data-testid="input-rent-ssh-key"
                    className={cn(
                      "input-field w-full font-mono text-[10px] px-3 py-2 resize-none",
                      sshKey.trim() && !sshValid && "border-destructive text-destructive"
                    )}
                  />
                  {sshKey.trim() && !sshValid && (
                    <p
                      className="font-mono text-[10px] text-destructive mt-1.5"
                      data-testid="text-ssh-invalid"
                    >
                      That doesn't look like a public key — it should start with ssh-ed25519 or ssh-rsa.
                    </p>
                  )}
                </div>
                
                <details className="provision-ssh-help">
                  <summary className="font-mono text-xs cursor-pointer py-2">Need an SSH key? View instructions</summary>
                  <SshKeyHelp os={sshOs} setOs={setSshOs} />
                </details>
                
                <div className="pt-2">
                  <InputRow
                    label="RECEIPT EMAIL (OPTIONAL)"
                    value={email}
                    onChange={setEmail}
                    placeholder="user@domain.com"
                    type="email"
                    testId="input-rent-email"
                  />
                </div>
              </div>
            </SectionBlock>

            <div className="bg-card border border-border p-4">
               <div className="flex items-center justify-between mb-4">
                  <span className="mono-label flex items-center gap-1.5"><Wallet className="h-3 w-3" /> PAYMENT · COOKIE CHAIN</span>
                </div>
                
                 <div className="grid grid-cols-3 gap-2 mb-4">
                  <button
                    type="button"
                    data-testid="option-currency-cook"
                    onClick={() => setCurrency("COOK")}
                    className={cn("font-mono text-[12px] font-bold py-2.5 transition-colors border border-border", currency === "COOK" ? "btn-primary" : "bg-muted/20 text-muted-foreground")}
                  >
                    COOK
                  </button>
                  <button
                    type="button"
                    data-testid="option-currency-sol"
                    onClick={() => setCurrency("SOL")}
                    className={cn("font-mono text-[12px] font-bold py-2.5 transition-colors border border-border flex flex-col items-center justify-center", currency === "SOL" ? "btn-primary" : "bg-muted/20 text-muted-foreground")}
                  >
                    <span>SOL</span>
                    <span className="block text-[8px] tracking-widest uppercase opacity-70 mt-0.5">+25% · Cookie Chain</span>
                  </button>
                </div>
                
                
                {!paymentReady && (
                  <div className="bg-destructive/10 border border-destructive/20 p-3 mb-4">
                    <p className="font-mono text-[10px] text-destructive flex gap-2 items-start" data-testid="text-payment-not-ready">
                      <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>COOK payments on Cookie Chain are not configured yet.</span>
                    </p>
                  </div>
                )}
                
                {error && (
                  <div className="bg-destructive/10 border border-destructive/20 p-3 mb-4">
                    <p className="font-mono text-[10px] text-destructive" data-testid="text-rent-error">
                      {error}
                    </p>
                  </div>
                )}

                <button
                  onClick={getQuote}
                  disabled={step === "quoting" || !(currency === "SOL" ? solPaymentReady : paymentReady)}
                  data-testid="button-get-quote"
                  className="btn-primary w-full py-3 px-4 font-mono font-bold text-[12px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {step === "quoting" ? (
                     <><Loader2 className="h-4 w-4 animate-spin" /> Quoting...</>
                  ) : (
                     <><DollarSign className="h-4 w-4" /> Get Live Quote</>
                  )}
                </button>
            </div>
          </div>
        </div>
      )}

      {(step === "quote" || step === "paying" || step === "confirming" || step === "confirm_failed") && rental && (
        <div className="max-w-md mx-auto py-4">
          <div className="text-center mb-6">
            <h2 className="font-mono font-bold text-xl uppercase tracking-tight">Review Quote</h2>
            <p className="font-mono text-[11px] text-muted-foreground mt-1">Order #{rental.id}</p>
          </div>
          
          <SectionBlock title="ORDER SUMMARY" className="mb-6">
            <div className="space-y-1">
              {[
                ["Hardware", `NVIDIA ${rental.gpuModel}`],
                ["Workload", rentalTemplate?.name ?? "Bare GPU"],
                ...(rental.repositoryUrl ? [["Source", `${rental.repositoryUrl.replace("https://github.com/", "")} @ ${rental.repositoryRevision ?? "default"}`]] as [string, string][] : []),
                ...(rental.containerImage ? [["Image", rental.containerImage]] as [string, string][] : []),
                ["Instance", INSTANCE_LABEL[rental.instanceType] ?? rental.instanceType],
                ["Duration", `${rental.durationHours} HR`],
                ...((rental.extraDiskGb ?? 0) > 0 ? [["Storage", `+${rental.extraDiskGb} GB`]] as [string, string][] : []),
                ...(rental.priceBreakdown?.diskUsd ? [["Disk Total", `$${rental.priceBreakdown.diskUsd.toFixed(2)}`]] as [string, string][] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 font-mono text-[12px] border-b border-border/50 last:border-0">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium text-right text-foreground">{v}</span>
                </div>
              ))}
            </div>
            
            {rental.priceBreakdown?.minimumApplied && (
               <div className="mt-3 p-2 bg-muted/30 border border-border text-center">
                <p className="font-mono text-[10px] text-muted-foreground" data-testid="text-min-order-note">
                  Minimum order size applied (${rental.priceBreakdown.minimumUsd.toFixed(2)})
                </p>
              </div>
            )}
          </SectionBlock>

          <div className="bg-card border border-border p-5 mb-6">
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-border">
               <span className="mono-label text-foreground">TOTAL AMOUNT</span>
               <div className="text-right">
                  <div className="font-mono font-bold text-2xl tracking-tight">
                    {rental.currency === "TOKEN"
                      ? <>{formatTokenDisplay((rental as Workspace & EvmPaymentQuote).amountBaseUnits, (rental as Workspace & EvmPaymentQuote).assetDecimals)} <span className="text-sm text-muted-foreground">$FR</span></>
                       : <>{formatEthDisplay((rental as Workspace & EvmPaymentQuote).solAmount)} <span className="text-sm text-muted-foreground">{rental.currency}</span></>}
                  </div>
               </div>
            </div>
            
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 p-3 mb-4">
                <p className="font-mono text-[10px] text-destructive text-center" data-testid="text-pay-error">
                  {error}
                </p>
              </div>
            )}

            {step === "confirm_failed" ? (
              <div className="space-y-4">
                 <p className="font-mono text-[11px] text-center text-muted-foreground bg-muted/30 p-3" data-testid="text-confirm-failed">
                  Payment sent, but confirmation timed out. Your funds are safe.
                </p>
                <button
                  onClick={pay}
                  data-testid="button-retry-confirm"
                  className="btn-primary w-full py-3 px-4 font-mono font-bold text-[12px] uppercase tracking-widest flex items-center justify-center gap-2"
                >
                   <RefreshCw className="h-4 w-4" /> RETRY CONFIRMATION
                </button>
              </div>
            ) : !connected ? (
              <button
                onClick={() => void connect()}
                data-testid="button-connect-to-pay"
                className="btn-primary w-full py-3 px-4 font-mono font-bold text-[12px] uppercase tracking-widest flex items-center justify-center gap-2"
              >
                <Wallet className="h-4 w-4" /> Connect Wallet to Pay
              </button>
            ) : (
              <button
                onClick={pay}
                disabled={step === "paying" || step === "confirming"}
                data-testid="button-pay"
                className="btn-primary w-full py-3 px-4 font-mono font-bold text-[12px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {step === "paying" ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> APPROVING...</>
                ) : step === "confirming" ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> PROVISIONING...</>
                ) : (
                  <><DollarSign className="h-4 w-4" /> PAY & PROVISION</>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {step === "success" && rental && (
        <div className="max-w-md mx-auto py-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>
          <h2 className="font-mono font-bold text-2xl uppercase tracking-tight mb-2">
             {rental.status === "active" ? "System Ready" : "Order Confirmed"}
          </h2>
          <p className="font-mono text-[12px] text-muted-foreground mb-8">
            {rental.status === "active"
              ? `Your NVIDIA ${rental.gpuModel} is spinning up.`
              : `Provisioning NVIDIA ${rental.gpuModel}. We'll email you when it's live.`}
          </p>
          
          <div className="bg-card border border-border p-4 mb-8 text-left max-w-sm mx-auto">
             {[
                ["Workspace ID", `#${rental.id}`],
                ["Provider ID", rental.vastInstanceId || "Pending..."],
                ["Status", rental.status.toUpperCase()],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2 font-mono text-[12px] border-b border-border/50 last:border-0">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-bold">{v}</span>
                </div>
              ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/workspaces"
              onClick={close}
              data-testid="link-view-rentals"
              className="btn-ghost py-3 px-6 font-mono font-bold text-[11px] uppercase tracking-widest w-full sm:w-auto"
            >
              VIEW WORKSPACES
            </Link>
            <button
              onClick={close}
              data-testid="button-rent-done"
              className="btn-primary py-3 px-8 font-mono font-bold text-[11px] uppercase tracking-widest w-full sm:w-auto"
            >
              DONE
            </button>
          </div>
        </div>
      )}
      </div>
    </Modal>
  );
}
