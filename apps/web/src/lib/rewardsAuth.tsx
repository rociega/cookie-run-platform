import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useEvmWallet } from "./wallet";
import {
  createAuthChallenge,
  verifyAuthSignature,
  setAuthTokenGetter,
  type RewardAccount,
} from "@workspace/api-client-react";

const TOKEN_PREFIX = "cookie_run_rewards_token_";
const REF_KEY = "cookie_run_rewards_ref";

function tokenKey(wallet: string) {
  return `${TOKEN_PREFIX}${wallet}`;
}

function loadToken(wallet: string): string | null {
  try {
    return localStorage.getItem(tokenKey(wallet));
  } catch {
    return null;
  }
}

function saveToken(wallet: string, token: string) {
  try {
    localStorage.setItem(tokenKey(wallet), token);
  } catch {
    /* ignore */
  }
}

function clearStoredToken(wallet: string) {
  try {
    localStorage.removeItem(tokenKey(wallet));
  } catch {
    /* ignore */
  }
}

interface RewardsAuthValue {
  walletAddress: string | null;
  connected: boolean;
  canSign: boolean;
  isAuthed: boolean;
  signingIn: boolean;
  error: string | null;
  account: RewardAccount | null;
  signIn: () => Promise<boolean>;
  signOut: () => void;
  /** Clears the in-memory + stored token (e.g. after a 401). */
  invalidateSession: () => void;
  setAccount: (a: RewardAccount | null) => void;
}

const Ctx = createContext<RewardsAuthValue | null>(null);

export function useRewardsAuth(): RewardsAuthValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRewardsAuth must be used within a RewardsAuthProvider");
  return ctx;
}

export function RewardsAuthProvider({ children }: { children: ReactNode }) {
  const { address: walletAddress, connected, signMessage } = useEvmWallet();

  const [token, setToken] = useState<string | null>(null);
  const [tokenWallet, setTokenWallet] = useState<string | null>(null);
  const [account, setAccount] = useState<RewardAccount | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type SessionSnapshot = {
    wallet: string | null;
    token: string | null;
    account: RewardAccount | null;
  };
  // The fetch getter reads one snapshot, rather than separate wallet/token
  // refs. A wallet switch therefore cannot expose the old token in the gap
  // between the wallet effect and React's state update.
  const sessionRef = useRef<SessionSnapshot>({
    wallet: null,
    token: null,
    account: null,
  });
  const activeWalletRef = useRef<string | null>(walletAddress);
  activeWalletRef.current = walletAddress;

  // Register the bearer-token getter once; custom-fetch attaches it to every call.
  useEffect(() => {
    setAuthTokenGetter(() => {
      const session = sessionRef.current;
      return session.wallet === activeWalletRef.current ? session.token : null;
    });
    return () => setAuthTokenGetter(null);
  }, []);

  // Capture a ?ref= referral code once, persist until the first sign-in consumes it.
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && ref.trim()) localStorage.setItem(REF_KEY, ref.trim());
    } catch {
      /* ignore */
    }
  }, []);

  // Load (or clear) the session whenever the active wallet changes.
  useEffect(() => {
    const next: SessionSnapshot = {
      wallet: walletAddress,
      token: walletAddress ? loadToken(walletAddress) : null,
      account: null,
    };
    // Publish the complete identity/token/account transition atomically before
    // any resulting query can read the auth getter.
    sessionRef.current = next;
    setTokenWallet(next.wallet);
    setToken(next.token);
    setAccount(null);
    setError(null);
  }, [walletAddress]);

  const signIn = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!walletAddress) {
      setError("Connect your wallet first.");
      return false;
    }
    if (!signMessage) {
      setError("This wallet can't sign messages. Try another compatible EVM wallet.");
      return false;
    }
    const signingWallet = walletAddress;
    setSigningIn(true);
    try {
      const challenge = await createAuthChallenge({ wallet: signingWallet });
      const signature = await signMessage(challenge.message);

      let referralCode: string | undefined;
      try {
        referralCode = localStorage.getItem(REF_KEY) ?? undefined;
      } catch {
        referralCode = undefined;
      }

      const session = await verifyAuthSignature({
        wallet: signingWallet,
        signature,
        challengeToken: challenge.challengeToken,
        referralCode,
      });

      // Do not install a session that was completed for a wallet the user has
      // already switched away from while the signing prompts were open.
      if (
        activeWalletRef.current !== signingWallet ||
        sessionRef.current.wallet !== signingWallet
      ) {
        return false;
      }
      sessionRef.current = {
        wallet: signingWallet,
        token: session.token,
        account: session.account,
      };
      saveToken(signingWallet, session.token);
      setToken(session.token);
      setTokenWallet(signingWallet);
      setAccount(session.account);
      try {
        localStorage.removeItem(REF_KEY);
      } catch {
        /* ignore */
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in failed.";
      setError(
        /reject|denied|cancel/i.test(msg) ? "Signature request was cancelled." : msg,
      );
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [walletAddress, signMessage]);

  const invalidateSession = useCallback(() => {
    sessionRef.current = {
      wallet: walletAddress,
      token: null,
      account: null,
    };
    if (walletAddress) clearStoredToken(walletAddress);
    setToken(null);
    setTokenWallet(null);
    setAccount(null);
  }, [walletAddress]);

  const signOut = useCallback(() => {
    invalidateSession();
    setError(null);
  }, [invalidateSession]);

  const updateAccount = useCallback((nextAccount: RewardAccount | null) => {
    // A mutation started before a wallet switch must not replace the new
    // wallet's account when its old response arrives.
    if (
      sessionRef.current.wallet !== walletAddress ||
      activeWalletRef.current !== walletAddress
    ) return;
    sessionRef.current = { ...sessionRef.current, account: nextAccount };
    setAccount(nextAccount);
  }, [walletAddress]);

  const value = useMemo<RewardsAuthValue>(
    () => ({
      walletAddress,
      connected,
      canSign: !!signMessage,
      isAuthed:
        !!token &&
        !!walletAddress &&
        tokenWallet === walletAddress,
      signingIn,
      error,
      account: tokenWallet === walletAddress ? account : null,
      signIn,
      signOut,
      invalidateSession,
      setAccount: updateAccount,
    }),
    [
      walletAddress,
      connected,
      signMessage,
      token,
      tokenWallet,
      signingIn,
      error,
      account,
      signIn,
      signOut,
      invalidateSession,
      updateAccount,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
