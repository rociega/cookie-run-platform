import { useState } from "react";
import { useEvmWallet } from "@/lib/wallet";
import { joinWhitelist } from "@workspace/api-client-react";
import { CheckCircle2 } from "lucide-react";
import Modal from "./Modal";

export default function WhitelistModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useEvmWallet();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  function close() {
    onClose();
    // Reset shortly after the exit animation.
    setTimeout(() => {
      setStatus("idle");
      setEmail("");
      setError(null);
    }, 250);
  }

  async function submit() {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter a valid email address");
      return;
    }
    setStatus("submitting");
    setError(null);
    try {
      await joinWhitelist({
        email: trimmed,
        walletAddress: address ?? undefined,
        source: "whitelist-cta",
      });
      setStatus("done");
    } catch (e) {
      setStatus("idle");
      setError((e as Error)?.message || "Something went wrong. Try again.");
    }
  }

  return (
    <Modal open={open} onClose={close} title="Join the Whitelist">
      {status === "done" ? (
        <div className="text-center py-3">
          <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-4" />
          <p className="font-black text-[18px] tracking-tight mb-2">You're on the list.</p>
          <p className="font-mono text-[12px] text-muted-foreground leading-relaxed mb-5">
            Check your inbox for confirmation. You will get priority early access and capacity
            updates as we expand the fleet.
          </p>
          <button
            onClick={close}
            data-testid="button-whitelist-done"
            className="premium-btn font-mono font-bold text-[11px] tracking-widest uppercase px-6 py-2.5"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <p className="font-mono text-[12px] text-muted-foreground leading-relaxed mb-4">
            Get priority early access as we bring new NVIDIA GPU capacity online. Availability
            is limited and verified per request during the controlled rollout.
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="you@domain.com"
            data-testid="input-whitelist-email"
            className="w-full bg-background font-mono text-[13px] px-3 py-2.5 mb-3 outline-none focus:border-primary"
            style={{ border: "1px solid rgba(255,255,255,0.12)" }}
          />
          {address && (
            <p className="font-mono text-[10px] text-muted-foreground/60 mb-3 tracking-wider">
              Linking wallet {address.slice(0, 4)}…{address.slice(-4)}
            </p>
          )}
          {error && (
            <p className="font-mono text-[11px] text-destructive mb-3" data-testid="text-whitelist-error">
              {error}
            </p>
          )}
          <button
            onClick={submit}
            disabled={status === "submitting"}
            data-testid="button-whitelist-submit"
            className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 w-full disabled:opacity-50"
          >
            {status === "submitting" ? "Joining…" : "Join the Whitelist"}
          </button>
        </>
      )}
    </Modal>
  );
}
