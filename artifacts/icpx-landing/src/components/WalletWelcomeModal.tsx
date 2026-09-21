import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { connectWallet, updateRewardProfile } from "@workspace/api-client-react";
import { useEvmWallet } from "@/lib/wallet";
import { useRewardsAuth } from "@/lib/rewardsAuth";
import Modal from "./Modal";

function shortAddress(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

/**
 * Single, app-level owner of the "Wallet Connected" welcome flow.
 * Mounted once so connecting a wallet records exactly one connection and
 * shows exactly one welcome modal, regardless of how many ConnectWalletButtons
 * are rendered across the page.
 */
export default function WalletWelcomeModal() {
  const { address, connected } = useEvmWallet();
  const { isSignedIn, user } = useUser();
  const { isAuthed, account, setAccount } = useRewardsAuth();
  const [, navigate] = useLocation();
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const recordedRef = useRef<string | null>(null);
  const boundRef = useRef<string | null>(null);

  useEffect(() => {
    if (connected && address && !isSignedIn) {
      const addr = address.toLowerCase();
      if (recordedRef.current !== addr) {
        recordedRef.current = addr;
        setWelcomeOpen(true);
      }
    } else if (!connected) {
      recordedRef.current = null;
    }
  }, [address, connected, isSignedIn]);

  // Once the user completes Clerk sign-in (e.g. via "Bind email or social
  // account"), carry their verified email over to the connected wallet's
  // rewards account so the bind actually persists something.
  useEffect(() => {
    if (!isSignedIn || !isAuthed || !account) return;
    if (account.email) return;
    const verifiedEmail = user?.primaryEmailAddress?.emailAddress;
    if (!verifiedEmail) return;
    if (boundRef.current === verifiedEmail) return;
    boundRef.current = verifiedEmail;
    void updateRewardProfile({ email: verifiedEmail })
      .then((updated) => setAccount(updated))
      .catch(() => {
        boundRef.current = null;
      });
  }, [isSignedIn, isAuthed, account, user, setAccount]);

  async function record(withEmail: boolean) {
    if (!address) return;
    setSubmitting(true);
    try {
      await connectWallet({
        address,
        email: withEmail && email.trim() ? email.trim() : undefined,
      });
    } catch {
      // Recording is best-effort; never block the UI on it.
    }
    setSubmitting(false);
    setWelcomeOpen(false);
    setEmail("");
  }

  function bindAccount() {
    setWelcomeOpen(false);
    navigate("/sign-in");
  }

  return (
    <Modal open={welcomeOpen} onClose={() => record(false)} title="Wallet connected">
      <p className="font-mono text-[12px] text-muted-foreground leading-relaxed mb-4">
        You're connected{address ? ` as ${shortAddress(address)}` : ""}. Bind an
        email or social account so you keep access to your rentals and rewards
        even if you switch wallets.
      </p>
      <button
        onClick={bindAccount}
        disabled={submitting}
        data-testid="button-welcome-bind-account"
        className="premium-btn font-mono font-bold text-[11px] tracking-widest uppercase px-5 py-2.5 w-full mb-4 disabled:opacity-50"
      >
        Bind email or social account
      </button>
      <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mb-2">Or just leave an email</p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@domain.com"
        data-testid="input-welcome-email"
        className="w-full bg-background border border-foreground/30 font-mono text-[13px] px-3 py-2.5 mb-4 outline-none focus:border-primary"
      />
      <div className="flex gap-3">
        <button
          onClick={() => record(true)}
          disabled={submitting || !email.trim()}
          data-testid="button-welcome-confirm"
          className="premium-btn-ghost font-mono font-bold text-[11px] tracking-widest uppercase px-5 py-2.5 flex-1 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save email"}
        </button>
        <button
          onClick={() => record(false)}
          disabled={submitting}
          data-testid="button-welcome-skip"
          className="premium-btn-ghost font-mono font-bold text-[11px] tracking-widest uppercase px-5 py-2.5 disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </Modal>
  );
}
