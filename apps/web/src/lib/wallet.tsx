import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";

export const COOKIE_CHAIN_RPC_URL = "https://rpc.cookiescan.io";
export const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
export const COOKIE_CHAIN_EXPLORER_URL = "https://cookiescan.io";
export const COOKIE_NATIVE_DECIMALS = 9;

type SolanaProvider = {
  publicKey?: PublicKey | { toBase58(): string } | null;
  isConnected?: boolean;
  connect?: () => Promise<unknown>;
  disconnect?: () => Promise<void>;
  signMessage?: (
    message: Uint8Array,
  ) => Promise<Uint8Array | string | { signature?: Uint8Array | string }>;
  sendTransaction?: (transaction: Transaction, connection: Connection) => Promise<string>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    nightly?: { solana?: SolanaProvider };
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}

interface CookieWalletValue {
  address: string | null;
  chainId: null;
  provider: Connection | null;
  solanaProvider: Connection | null;
  connection: Connection;
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  providers: [];
  connect: (providerId?: string) => Promise<string | null>;
  disconnect: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  sendTransaction: (transaction: Transaction) => Promise<string>;
  sendTransactionOnNetwork: (transaction: Transaction, network: "cookie" | "solana") => Promise<string>;
  ensureCookieChain: () => Promise<void>;
}

const CookieWalletContext = createContext<CookieWalletValue | null>(null);

function walletFromWindow(): SolanaProvider | null {
  if (typeof window === "undefined") return null;
  return (
    window.nightly?.solana ??
    window.phantom?.solana ??
    window.solana ??
    null
  );
}

function keyFromProvider(provider: SolanaProvider | null): PublicKey | null {
  const value = provider?.publicKey;
  if (!value) return null;
  try {
    return value instanceof PublicKey ? value : new PublicKey(value.toBase58());
  } catch {
    return null;
  }
}

function readableWalletError(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : error instanceof Error
        ? error.message
        : "Wallet request failed.";
  if (/reject|denied|cancel|declin/i.test(message)) return "Wallet request was cancelled.";
  return message;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function CookieWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/solana-rpc`;
    }
    return COOKIE_CHAIN_RPC_URL;
  }, []);
  const solanaEndpoint = useMemo(() => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/solana-rpc?network=solana`;
    }
    return SOLANA_RPC_URL;
  }, []);
  const connection = useMemo(() => new Connection(endpoint, "confirmed"), [endpoint]);
  const solanaConnection = useMemo(() => new Connection(solanaEndpoint, "confirmed"), [solanaEndpoint]);
  const [wallet, setWallet] = useState<SolanaProvider | null>(null);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncWallet = useCallback((next: SolanaProvider | null) => {
    setWallet(next);
    setPublicKey(keyFromProvider(next));
  }, []);

  useEffect(() => {
    const next = walletFromWindow();
    if (next?.isConnected || next?.publicKey) syncWallet(next);
  }, [syncWallet]);

  useEffect(() => {
    if (!wallet) return;
    const handleAccountChanged = () => setPublicKey(keyFromProvider(wallet));
    wallet.on?.("accountChanged" as never, handleAccountChanged as never);
    return () => wallet.off?.("accountChanged" as never, handleAccountChanged as never);
  }, [wallet]);

  const connect = useCallback(async () => {
    const next = walletFromWindow();
    if (!next?.connect) {
      const message = "Install Nightly Wallet to pay on Cookie Chain.";
      setError(message);
      return null;
    }
    setConnecting(true);
    setError(null);
    try {
      await next.connect();
      syncWallet(next);
      const key = keyFromProvider(next);
      if (!key) throw new Error("Wallet connected without a public address.");
      return key.toBase58();
    } catch (cause) {
      setError(readableWalletError(cause));
      return null;
    } finally {
      setConnecting(false);
    }
  }, [syncWallet]);

  const disconnect = useCallback(async () => {
    try {
      await wallet?.disconnect?.();
    } finally {
      syncWallet(null);
      setError(null);
    }
  }, [syncWallet, wallet]);

  const signMessage = useCallback(async (message: string) => {
    if (!wallet || !publicKey || !wallet.signMessage) {
      throw new Error("Connect a Cookie Chain wallet that supports message signing.");
    }
    const result = await wallet.signMessage(new TextEncoder().encode(message));
    if (typeof result === "string") return result;
    if (result instanceof Uint8Array) return encodeBase64(result);
    const nested = result?.signature;
    if (typeof nested === "string") return nested;
    if (nested instanceof Uint8Array) return encodeBase64(nested);
    throw new Error("Wallet returned an unsupported signature format.");
  }, [publicKey, wallet]);

  const sendTransaction = useCallback(async (transaction: Transaction) => {
    if (!wallet || !publicKey || !wallet.sendTransaction) {
      throw new Error("Connect a Nightly wallet to continue.");
    }
    return wallet.sendTransaction(transaction, connection);
  }, [connection, publicKey, wallet]);

  const sendTransactionOnNetwork = useCallback(async (
    transaction: Transaction,
    network: "cookie" | "solana",
  ) => {
    if (!wallet || !publicKey || !wallet.sendTransaction) {
      throw new Error("Connect a Nightly wallet to continue.");
    }
    return wallet.sendTransaction(
      transaction,
      network === "solana" ? solanaConnection : connection,
    );
  }, [connection, publicKey, solanaConnection, wallet]);

  const ensureCookieChain = useCallback(async () => {
    if (!wallet || !publicKey) throw new Error("Connect a Cookie Chain wallet first.");
  }, [publicKey, wallet]);

  const value = useMemo<CookieWalletValue>(() => ({
    address: publicKey?.toBase58() ?? null,
    chainId: null,
    provider: connection,
    solanaProvider: solanaConnection,
    connection,
    publicKey,
    connected: !!wallet && !!publicKey,
    connecting,
    error,
    providers: [],
    connect,
    disconnect,
    signMessage,
    sendTransaction,
    sendTransactionOnNetwork,
    ensureCookieChain,
  }), [
    connect,
    connecting,
    connection,
    disconnect,
    ensureCookieChain,
    error,
    publicKey,
    sendTransaction,
    sendTransactionOnNetwork,
    signMessage,
    wallet,
  ]);

  return <CookieWalletContext.Provider value={value}>{children}</CookieWalletContext.Provider>;
}

export function useEvmWallet(): CookieWalletValue {
  const context = useContext(CookieWalletContext);
  if (!context) throw new Error("useEvmWallet must be used within CookieWalletProvider.");
  return context;
}

// Kept as the app wrapper name so the rest of the landing app and its layout
// remain unchanged. The active wallet is now the Solana-compatible Cookie Chain
// provider rather than Privy/EVM.
export function SolanaProvider({ children }: { children: ReactNode }) {
  return <CookieWalletProvider>{children}</CookieWalletProvider>;
}