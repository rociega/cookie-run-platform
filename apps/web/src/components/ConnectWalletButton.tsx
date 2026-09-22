import { Loader2, Wallet } from "lucide-react";
import { useEvmWallet } from "@/lib/wallet";

function shortAddress(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export default function ConnectWalletButton({ className }: { className?: string }) {
  const { address, connected, connecting, connect, disconnect, error } = useEvmWallet();

  if (connected && address) {
    return (
      <button
        onClick={() => void disconnect()}
        title="Click to disconnect"
        data-testid="button-wallet-address"
        className={className}
      >
        <Wallet className="h-3.5 w-3.5" /> {shortAddress(address)}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void connect()}
        disabled={connecting}
        data-testid="button-connect-wallet"
        className={className}
      >
        {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {connecting ? "Connecting…" : "Connect Wallet"}
      </button>
      {error && <p className="absolute right-0 mt-1 w-64 text-right font-mono text-[10px] text-destructive">{error}</p>}
    </div>
  );
}
