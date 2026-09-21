import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyWorkspaces,
  getGetMyWorkspacesQueryKey,
  createWorkspaceTerminalTicket,
  useGetComputeTemplates,
  type WorkspaceWithInstance,
  type ComputeTemplate,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Cpu,
  Server,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Terminal,
  Globe,
  AlertTriangle,
  Sparkles,
  X,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import { AppShell } from "@/components/AppShell";
import { useIcpx } from "@/lib/icpx";

import { useRewardsAuth } from "@/lib/rewardsAuth";

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const SECTION_LABEL =
  "font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground";

const INSTANCE_LABEL: Record<string, string> = {
  "on-demand": "On-Demand",
  spot: "Spot",
  reserved: "Reserved",
};

// Tone for a live/order status pill. Lime for healthy, red for failed states,
// muted for in-between (provisioning / loading).
function tone(status: string | null | undefined): "ok" | "bad" | "wait" {
  const s = (status ?? "").toLowerCase();
  if (["active", "running"].includes(s)) return "ok";
  if (["failed", "error", "exited", "offline", "cancelled"].includes(s))
    return "bad";
  return "wait";
}

function StatusPill({ status }: { status: string | null | undefined }) {
  const t = tone(status);
  const label = (status ?? "unknown").replace(/_/g, " ");
  const styles =
    t === "ok"
      ? { color: "hsl(var(--live))", border: "rgba(137,247,255,0.2)", bg: "rgba(137,247,255,0.05)" }
      : t === "bad"
        ? { color: "hsl(var(--destructive))", border: "hsl(var(--destructive))", bg: "transparent" }
        : { color: "hsl(var(--muted-foreground))", border: "rgba(255,255,255,0.18)", bg: "transparent" };
  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-md whitespace-nowrap inline-flex items-center gap-1.5"
      style={{ color: styles.color, border: `1px solid ${styles.border}`, background: styles.bg }}
    >
      {t === "ok" && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "hsl(var(--live))" }}
        />
      )}
      {label}
    </span>
  );
}

function CopyButton({ value, testId }: { value: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  }, [value]);
  return (
    <button
      onClick={copy}
      data-testid={testId}
      title="Copy to clipboard"
      className="h-8 px-3 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium flex items-center gap-1.5 shrink-0 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* A single read-only field row with optional copy affordance. */
function DetailRow({
  label,
  value,
  mono = true,
  copy,
  copyTestId,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  copy?: string;
  copyTestId?: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border"
    >
      <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground shrink-0">
        {label}
      </span>
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn("truncate text-sm font-medium", mono && "font-mono")}>{value}</span>
        {copy && <CopyButton value={copy} testId={copyTestId} />}
      </div>
    </div>
  );
}

/* ──────────────────── In-browser SSH terminal ──────────────────── */
type TermPhase = "key" | "connecting" | "open" | "closed";

function TerminalModal({
  rental,
  onClose,
}: {
  rental: WorkspaceWithInstance;
  onClose: () => void;
}) {
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [phase, setPhase] = useState<TermPhase>("key");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const keyRef = useRef<{ privateKey: string; passphrase: string } | null>(null);

  const teardown = useCallback(() => {
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    wsRef.current = null;
    try {
      termRef.current?.dispose();
    } catch {
      /* ignore */
    }
    termRef.current = null;
    fitRef.current = null;
    keyRef.current = null;
  }, []);

  // Always tear down on unmount so the socket + key never linger.
  useEffect(() => () => teardown(), [teardown]);

  const connect = useCallback(async () => {
    if (!privateKey.trim()) {
      setStatusMsg("Paste your SSH private key to connect.");
      return;
    }
    // Hold the key in a ref and clear it from React state immediately so it isn't
    // retained in component state longer than needed.
    keyRef.current = { privateKey, passphrase };
    setPrivateKey("");
    setPassphrase("");
    setPhase("connecting");
    setStatusMsg("Requesting access…");

    try {
      const { ticket } = await createWorkspaceTerminalTicket(rental.id);
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/api/workspaces/${rental.id}/terminal?ticket=${encodeURIComponent(ticket)}`;
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setPhase("open");
        setStatusMsg(null);
        const term = new XtermTerminal({
          cursorBlink: true,
          fontFamily: '"Space Mono", ui-monospace, monospace',
          fontSize: 13,
          theme: {
            background: "#000000",
            foreground: "#e6e6e6",
            cursor: "#C798FF",
          },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        if (containerRef.current) {
          term.open(containerRef.current);
          try {
            fit.fit();
          } catch {
            /* ignore */
          }
        }
        termRef.current = term;
        fitRef.current = fit;

        const k = keyRef.current;
        ws.send(
          JSON.stringify({
            type: "auth",
            privateKey: k?.privateKey ?? "",
            passphrase: k?.passphrase || undefined,
            cols: term.cols,
            rows: term.rows,
          }),
        );
        keyRef.current = null; // key handed off — drop the in-memory copy

        term.onData((d) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "data", data: d }));
          }
        });
        term.focus();
      };

      ws.onmessage = (ev) => {
        const term = termRef.current;
        if (!term) return;
        if (typeof ev.data === "string") term.write(ev.data);
        else term.write(new Uint8Array(ev.data as ArrayBuffer));
      };

      ws.onclose = () => setPhase("closed");
      ws.onerror = () => setStatusMsg("Connection error.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not open terminal.";
      setStatusMsg(
        /401|sign in|auth/i.test(msg) ? "Session expired — sign in again." : msg,
      );
      setPhase("key");
      keyRef.current = null;
    }
  }, [privateKey, passphrase, rental.id]);

  // Keep the terminal sized to its container and tell the server the new window.
  useEffect(() => {
    if (phase !== "open") return;
    const onResize = () => {
      const fit = fitRef.current;
      const term = termRef.current;
      const ws = wsRef.current;
      if (!fit || !term) return;
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
        );
      }
    };
    window.addEventListener("resize", onResize);
    const t = setTimeout(onResize, 60);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(t);
    };
  }, [phase]);

  const reconnect = useCallback(() => {
    teardown();
    setStatusMsg(null);
    setPhase("key");
  }, [teardown]);

  const close = useCallback(() => {
    teardown();
    onClose();
  }, [teardown, onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={close}
    >
      <div
        className="glass-panel w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Terminal className="h-4 w-4 text-primary shrink-0" />
            <span className="font-mono text-[12px] tracking-widest uppercase truncate">
              Web Terminal · Workspace #{rental.id}
            </span>
          </div>
          <button
            onClick={close}
            data-testid={`button-close-terminal-${rental.id}`}
            className="premium-btn-ghost p-1.5"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        {phase === "key" ? (
          <div className="p-5 overflow-auto">
            <p className="font-mono text-[12px] text-muted-foreground leading-relaxed mb-4">
              Paste the SSH private key that matches the public key you used at
              checkout. It connects you to{" "}
              <span className="text-foreground">root@{rental.gpuModel}</span>.
            </p>

            <label className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
              Private key
            </label>
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              data-testid={`input-private-key-${rental.id}`}
              placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"}
              className="w-full h-40 mt-1.5 bg-black/60 font-mono text-[11px] p-3 resize-none outline-none border border-white/10"
            />

            <label className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mt-4 block">
              Passphrase <span className="opacity-50">(if your key has one)</span>
            </label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="off"
              data-testid={`input-passphrase-${rental.id}`}
              className="w-full mt-1.5 bg-black/60 font-mono text-[12px] px-3 py-2.5 outline-none border border-white/10"
            />

            <div
              className="flex items-start gap-2 mt-4 px-3 py-2.5 font-mono text-[10px] text-muted-foreground leading-relaxed border border-white/10 bg-white/5"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              Your key is sent over an encrypted connection and held in memory only
              for this session. It is never stored on our servers or written to any
              log.
            </div>

            {statusMsg && (
              <p className="font-mono text-[12px] text-destructive mt-3">
                {statusMsg}
              </p>
            )}

            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={() => void connect()}
                data-testid={`button-terminal-connect-${rental.id}`}
                className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 inline-flex items-center gap-2"
              >
                <KeyRound className="h-4 w-4" /> Connect
              </button>
              <button
                onClick={close}
                className="premium-btn-ghost font-mono font-bold text-[12px] tracking-widest uppercase px-5 py-3"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            {phase !== "open" && (
              <div className="flex items-center gap-2 px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                {phase === "connecting" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {statusMsg ?? "Connecting…"}
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                    Session ended.
                    <button
                      onClick={reconnect}
                      data-testid={`button-terminal-reconnect-${rental.id}`}
                      className="premium-btn-ghost font-mono text-[10px] tracking-widest uppercase px-2.5 py-1 ml-1"
                    >
                      Reconnect
                    </button>
                  </>
                )}
              </div>
            )}
            <div
              ref={containerRef}
              data-testid={`terminal-${rental.id}`}
              className="flex-1 min-h-[320px] bg-black p-2"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function RentalCard({
  r,
  template,
}: {
  r: WorkspaceWithInstance;
  template?: ComputeTemplate;
}) {
  const [showTerminal, setShowTerminal] = useState(false);
  const inst = r.instance ?? null;
  // Prefer the raw public IP over the provider's hostname to avoid third-party
  // branding in the connection string shown to users.
  const sshTarget = inst?.publicIp ?? inst?.sshHost ?? null;
  const ssh =
    sshTarget && inst?.sshPort
      ? `ssh -p ${inst.sshPort} root@${sshTarget}`
      : null;
  // The web terminal needs a live instance with SSH reachable (server resolves
  // the real host); gate on the same signal as the copy-paste command.
  const canOpenTerminal = !!(inst?.sshHost && inst?.sshPort);
  const gpuLine = inst?.gpuName
    ? `${inst.numGpus && inst.numGpus > 1 ? `${inst.numGpus}× ` : ""}${inst.gpuName}`
    : `NVIDIA ${r.gpuModel}`;
  // HTTP-access templates (apps / inference servers) expose a browser URL on the
  // instance's public IP + the template's published port; dev/training/game
  // templates stay SSH-only.
  const httpUrl =
    template?.accessType === "http" &&
    inst?.publicIp &&
    template.accessPort != null
      ? `http://${inst.publicIp}:${template.accessPort}`
      : null;
  // A paid order with no instance after ~15 min isn't the normal provisioning
  // wait anymore — the operator has been alerted server-side. Tell the workspace owner so
  // they aren't left staring at an indefinite spinner thinking they overpaid.
  const stuckProvisioning =
    r.status !== "active" &&
    !r.vastInstanceId &&
    Date.now() - new Date(r.createdAt).getTime() > 15 * 60 * 1000;

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm" data-testid={`card-rental-${r.id}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Cpu className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-lg tracking-tight truncate" data-testid={`text-rental-gpu-${r.id}`}>
              {gpuLine}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              Workspace #{r.id} · {r.durationHours}h · {fmtDate(r.createdAt)}
            </div>
          </div>
        </div>
        <StatusPill status={inst?.actualStatus ?? r.status} />
      </div>

      {/* Connection / status details */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-secondary/30">
          <Server className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
            Connection
          </span>
        </div>

        {ssh ? (
          <>
            <div
              className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Terminal className="h-4 w-4 text-primary shrink-0" />
                <code
                  className="font-mono text-sm truncate bg-secondary/50 px-1.5 py-0.5 rounded"
                  data-testid={`text-ssh-${r.id}`}
                >
                  {ssh}
                </code>
              </div>
              <CopyButton value={ssh} testId={`button-copy-ssh-${r.id}`} />
            </div>
            <div
              className="px-4 py-2 text-xs font-medium text-muted-foreground border-t border-border bg-secondary/10"
            >
              Connects using the SSH key you provided at checkout. No password needed.
            </div>
            {canOpenTerminal && (
              <div
                className="px-4 py-3 border-t border-border"
              >
                <button
                  onClick={() => setShowTerminal(true)}
                  data-testid={`button-open-terminal-${r.id}`}
                  className="h-9 px-4 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-semibold inline-flex items-center gap-2 transition-colors"
                >
                  <Terminal className="h-4 w-4" /> Open web terminal
                </button>
              </div>
            )}
          </>
        ) : (
          <div
            className={`flex items-start gap-2 px-4 py-3 text-sm font-medium border-t border-border ${
              stuckProvisioning ? "text-muted-foreground" : "text-muted-foreground"
            }`}
            data-testid={`text-provision-status-${r.id}`}
          >
            <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
            <span>
              {r.status === "active"
                ? "Connection details not available yet — refresh shortly."
                : stuckProvisioning
                  ? "This is taking longer than expected. We're escalating this to secure a machine — you won't be charged extra. Check back shortly, or contact support if it persists."
                  : "Provisioning — connection details appear once the instance is live."}
            </span>
          </div>
        )}

        {httpUrl && (
          <>
            <div
              className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Globe className="h-4 w-4 text-primary shrink-0" />
                <code
                  className="font-mono text-sm truncate bg-secondary/50 px-1.5 py-0.5 rounded"
                >
                  {httpUrl}
                </code>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={httpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`link-open-app-${r.id}`}
                  className="h-8 px-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                >
                  Open
                </a>
                <CopyButton value={httpUrl} testId={`button-copy-http-${r.id}`} />
              </div>
            </div>
            <div
              className="px-4 py-2 text-xs font-medium text-muted-foreground border-t border-border bg-secondary/10"
            >
              {template?.accessLabel
                ? `Open ${template.accessLabel} in your browser once the instance is live.`
                : "Open in your browser once the instance is live."}
            </div>
          </>
        )}

        {template && (
          <DetailRow label="Workload" value={template.name} mono={false} />
        )}
        {r.repositoryUrl && (
          <DetailRow
            label="Source"
            value={`${r.repositoryUrl.replace("https://github.com/", "")} @ ${r.repositoryRevision ?? "default"}`}
            mono={false}
          />
        )}
        {r.containerImage && (
          <DetailRow label="Image" value={r.containerImage} mono={false} />
        )}
        <DetailRow
          label="Type"
          value={INSTANCE_LABEL[r.instanceType] ?? r.instanceType}
          mono={false}
        />
        {(r.extraDiskGb ?? 0) > 0 && (
          <DetailRow label="Extra disk" value={`+${r.extraDiskGb} GB`} />
        )}

        {inst?.publicIp && (
          <DetailRow
            label="Public IP"
            value={inst.publicIp}
            copy={inst.publicIp}
            copyTestId={`button-copy-ip-${r.id}`}
          />
        )}
        {inst?.statusMsg && (
          <DetailRow label="Machine" value={inst.statusMsg} mono={false} />
        )}
        <DetailRow
          label="Instance"
          value={r.vastInstanceId || "—"}
        />
        <DetailRow
          label="Paid"
          value={
            r.currency === "ICPX"
              ? `${r.tokenAmount ?? "—"} ICPX · $${r.priceUsd}`
              : `${r.solAmount} SOL · $${r.priceUsd}`
          }
        />
      </div>

      {!inst && r.vastInstanceId && (
        <p className="font-mono text-[11px] text-muted-foreground mt-3 flex items-start gap-1.5">
          <Globe className="h-3 w-3 mt-0.5 shrink-0" />
          Live status temporarily unavailable. Your instance ID is{" "}
          <span className="text-foreground">{r.vastInstanceId}</span>.
        </p>
      )}

      {showTerminal && (
        <TerminalModal rental={r} onClose={() => setShowTerminal(false)} />
      )}
    </div>
  );
}

/* ────────────────────────── Auth gate ────────────────────────── */
function Gate({
  connected,
  canSign,
  signingIn,
  signIn,
  error,
}: {
  connected: boolean;
  canSign: boolean;
  signingIn: boolean;
  signIn: () => Promise<boolean>;
  error: string | null;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-8 sm:p-12 max-w-xl">
      <Server className="h-10 w-10 text-primary mb-6" />
      <h2 className="font-bold text-3xl tracking-tight mb-3">
        {connected ? "Sign in to view your machines" : "Connect your wallet"}
      </h2>
      <p className="text-base text-muted-foreground leading-relaxed mb-8">
        {connected
          ? "Sign a free message to prove you own this wallet. We'll show every machine this wallet has provisioned, with live connection details. It's off-chain and won't move any funds."
          : "Your workspaces are tied to the wallet that paid. Connect the wallet you paid with to view them."}
      </p>

      {!connected ? (
        <ConnectWalletButton className="bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-8 rounded-full font-semibold inline-flex items-center gap-2 transition-colors" />
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => void signIn()}
            disabled={!canSign || signingIn}
            data-testid="button-sign-in"
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-8 rounded-full font-semibold inline-flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            {signingIn ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
            {signingIn ? "Check your wallet…" : "Sign in with wallet"}
          </button>
          {!canSign && (
            <p className="text-sm text-destructive">
              This wallet can't sign messages. Try Phantom, Solflare, or Backpack.
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-destructive mt-4">{error}</p>}
    </div>
  );
}

/* ────────────────────────── Page ────────────────────────── */
export default function Rentals() {
  const {
    isAuthed,
    connected,
    walletAddress,
    canSign,
    signingIn,
    signIn,
    signOut,
    error,
    invalidateSession,
  } = useRewardsAuth();
  const { openRent } = useIcpx();
  const queryClient = useQueryClient();

  const rentalsQ = useGetMyWorkspaces({
    query: {
      enabled: isAuthed,
      // Workspaces are wallet-scoped. The generated client key is shared by
      // every wallet, which can briefly show the previous wallet's list while
      // a new session is loading (and can make a newly provisioned workspace
      // look absent). Keep each identity in its own cache bucket.
      queryKey: [...getGetMyWorkspacesQueryKey(), walletAddress ?? "anonymous"],
      refetchInterval: 20_000,
    },
  });

  const templatesQ = useGetComputeTemplates();
  const templateMap = useMemo(() => {
    const m = new Map<string, ComputeTemplate>();
    (templatesQ.data ?? []).forEach((t) => m.set(t.id, t));
    return m;
  }, [templatesQ.data]);

  // A stale/expired bearer token surfaces as a 401 — drop the session.
  useEffect(() => {
    const err = rentalsQ.error as { status?: number } | null;
    if (isAuthed && err && err.status === 401) invalidateSession();
  }, [rentalsQ.error, isAuthed, invalidateSession]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: [...getGetMyWorkspacesQueryKey(), walletAddress ?? "anonymous"],
    });
  }, [queryClient, walletAddress]);

  const rentals = rentalsQ.data ?? [];

  return (
    <AppShell>
      <div className="max-w-[1400px] w-full mx-auto px-5 md:px-8 py-10">
        {/* Title */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <h1 className="font-semibold text-3xl tracking-tight">Workspaces</h1>
            {isAuthed && (
              <button onClick={refresh} disabled={rentalsQ.isFetching} data-testid="button-refresh-workspaces" className="premium-btn-ghost gap-2">
                <RefreshCw className={cn("h-4 w-4", rentalsQ.isFetching && "animate-spin")} /> Refresh
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-3 max-w-xl leading-relaxed">
            Every machine provisioned from the wallet you sign in with, plus live SSH and
            connection details for each active workspace.
          </p>
        </div>

        {/* Gate: connect / sign-in */}
        {!isAuthed ? (
          <Gate
            connected={connected}
            canSign={canSign}
            signingIn={signingIn}
            signIn={signIn}
            error={error}
          />
        ) : rentalsQ.isLoading ? (
          <div className="flex items-center gap-2 font-mono text-[13px] text-muted-foreground py-10">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your workspaces…
          </div>
        ) : rentalsQ.isError ? (
          <div className="glass-panel p-8 max-w-xl">
            <AlertTriangle className="h-7 w-7 text-destructive mb-4" />
            <h2 className="font-bold text-xl tracking-tight mb-2">Couldn't load workspaces</h2>
            <p className="font-mono text-[13px] text-muted-foreground mb-5">
              Something went wrong fetching your workspaces. Please try again.
            </p>
            <button
              onClick={refresh}
              data-testid="button-retry-workspaces"
              className="premium-btn font-mono font-bold text-[11px] tracking-widest uppercase px-5 py-2.5 inline-flex items-center gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        ) : rentals.length === 0 ? (
            <div className="glass-panel p-8 sm:p-12 max-w-xl" data-testid="empty-workspaces">
            <Cpu className="h-8 w-8 text-primary mb-5" />
            <h2 className="font-bold text-2xl tracking-tight mb-2">No workspaces yet</h2>
            <p className="font-mono text-[13px] text-muted-foreground leading-relaxed mb-6">
              This wallet hasn't provisioned a machine yet. Paid with a different wallet?
              Disconnect and sign in with the one you paid with.
            </p>
            <button
              type="button"
              onClick={() => openRent()}
              data-testid="link-provision-machine"
              className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 inline-flex items-center gap-2"
            >
              <Cpu className="h-4 w-4" /> Provision a machine
            </button>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {rentals.map((r) => (
              <RentalCard
                key={r.id}
                r={r}
                template={r.templateId ? templateMap.get(r.templateId) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
