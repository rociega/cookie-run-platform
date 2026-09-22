import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Coins, Flame, Dice5, Pickaxe, Brain, HelpCircle,
  Target, Share2, Trophy, Check, Loader2, Twitter,
  Gift, ChevronRight, Sparkles, Lock, Unlock, Layers, Server,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyRewards,
  useGetRewardGames,
  useGetLeaderboard,
  useGetRewardActions,
  useUpdateRewardProfile,
  useClaimDailyCheckin,
  useClaimSpin,
  useClaimMine,
  useSubmitQuiz,
  useSubmitTrivia,
  useSubmitPriceGuess,
  useClaimSocial,
  useGetMyStakes,
  useCreateStake,
  useUnstakeStake,
  useGetChallenges,
  useClaimChallenge,
  useGetMissions,
  useSubmitMission,
  getGetMyRewardsQueryKey,
  getGetLeaderboardQueryKey,
  getGetRewardGamesQueryKey,
  getGetMyStakesQueryKey,
  getGetChallengesQueryKey,
  getGetMissionsQueryKey,
  type ActionStatus,
  type EarnResult,
  type RewardAction,
  type StakeView,
  type ChallengeView,
  type MissionView,
} from "@workspace/api-client-react";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import { AppShell } from "@/components/AppShell";
import { useRewardsAuth } from "@/lib/rewardsAuth";
import { useToast } from "@/hooks/use-toast";

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function fmt(n: string | number): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!isFinite(v)) return "0";
  return Math.round(v).toLocaleString();
}

function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function statusFor(actions: ActionStatus[] | undefined, type: string): ActionStatus | undefined {
  return actions?.find((a) => a.type === type);
}

function countdown(toIso: string | null | undefined): string {
  if (!toIso) return "";
  const ms = new Date(toIso).getTime() - Date.now();
  if (ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// Coarse "unlocks in …" label that prefers days for multi-day stake terms.
function unlockLabel(toIso: string | null | undefined): string {
  if (!toIso) return "";
  const ms = new Date(toIso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const d = Math.floor(ms / 86_400_000);
  if (d > 0) return `${d}d`;
  const h = Math.floor(ms / 3_600_000);
  if (h > 0) return `${h}h`;
  const m = Math.max(1, Math.floor(ms / 60_000));
  return `${m}m`;
}

const SECTION_LABEL =
  "font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground";
const CARD = "bg-card border border-border rounded-xl p-6 shadow-sm";

/* ────────────────────────── Card shell ────────────────────────── */
function GameCard({
  icon, title, amount, cadence, children,
}: {
  icon: React.ReactNode;
  title: string;
  amount?: number;
  cadence?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={CARD}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="text-primary">{icon}</span>
          <span className="font-mono font-bold text-[13px] tracking-wide uppercase">{title}</span>
        </div>
        {amount != null && (
          <span className="font-mono text-[10px] text-primary tracking-widest uppercase whitespace-nowrap border border-white/20 bg-white/5 px-1.5 py-0.5">
            +{fmt(amount)}{cadence === "daily" ? "/day" : ""}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function PrimaryBtn({
  onClick, disabled, busy, children, className,
}: {
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "premium-btn font-mono font-bold text-[11px] tracking-widest uppercase px-4 py-2.5 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

function DoneTag({ label = "Claimed" }: { label?: string }) {
  return (
    <span className="font-mono text-[11px] tracking-widest uppercase text-primary flex items-center gap-1.5">
      <Check className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

/* ────────────────────────── Page ────────────────────────── */
export default function Rewards() {
  const { isAuthed, connected, canSign, signingIn, signIn, signOut, error, walletAddress, invalidateSession } =
    useRewardsAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const walletScope = isAuthed ? (walletAddress ?? "anonymous") : "anonymous";

  const profileQ = useGetMyRewards({
    query: {
      enabled: isAuthed,
      queryKey: [...getGetMyRewardsQueryKey(), walletScope],
    },
  });
  const gamesQ = useGetRewardGames({
    query: {
      enabled: isAuthed,
      queryKey: [...getGetRewardGamesQueryKey(), walletScope],
    },
  });
  const leaderboardQ = useGetLeaderboard();
  const actionsQ = useGetRewardActions();

  const profile = profileQ.data;
  const account = profile?.account;
  const actionDefs = actionsQ.data;

  // A stale/expired bearer token surfaces as a 401 — drop the session.
  useEffect(() => {
    const err = profileQ.error as { status?: number } | null;
    if (isAuthed && err && err.status === 401) invalidateSession();
  }, [profileQ.error, isAuthed, invalidateSession]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: [...getGetMyRewardsQueryKey(), walletScope],
    });
    queryClient.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() });
    queryClient.invalidateQueries({
      queryKey: [...getGetRewardGamesQueryKey(), walletScope],
    });
  }, [queryClient, walletScope]);

  const onEarn = useCallback(
    (earn: EarnResult, fallback?: string) => {
      if (earn.credited) {
        toast({ title: `+${fmt(earn.amount)} pts`, description: earn.message });
      } else if (earn.alreadyEarned) {
        toast({ title: "Already claimed", description: earn.message });
      } else if (fallback) {
        toast({ title: fallback, description: earn.message });
      }
      refresh();
    },
    [toast, refresh],
  );

  const defFor = useCallback(
    (type: string): RewardAction | undefined => actionDefs?.find((a) => a.type === type),
    [actionDefs],
  );

  return (
    <AppShell>
      <div className="max-w-[1400px] w-full mx-auto px-4 md:px-6 py-8 md:py-12">
        {/* Title */}
        <div className="mb-8 md:mb-12 max-w-3xl">
          <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-2">Off-chain points · No token required</div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Earn <span className="text-primary">Cookie Run points</span>
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            Complete useful platform actions and games to grow your Cookie Run points balance. Points are tracked
            per wallet — they are off-chain and never move funds.
          </p>
        </div>

        {/* Launch event: 10 challenges, visible whether or not you're signed in */}
        <section className="mb-8 md:mb-12">
          <ChallengesSection isAuthed={isAuthed} walletAddress={walletAddress} />
        </section>

        {/* Hackathon: 10 technical missions, visible whether or not you're signed in */}
        <section className="mb-8 md:mb-12">
          <MissionsSection isAuthed={isAuthed} walletAddress={walletAddress} />
        </section>

        {/* Gate: connect / sign-in */}
        {!isAuthed ? (
          <Gate
            connected={connected}
            canSign={canSign}
            signingIn={signingIn}
            signIn={signIn}
            error={error}
          />
        ) : (
          <div className="space-y-8">
            {/* Balance + profile */}
            <div className="grid gap-6 lg:grid-cols-3">
              <BalanceHero
                balance={account?.balance ?? "0"}
                handle={account?.handle ?? null}
                wallet={walletAddress}
              />
              <ProfileCard
                handle={account?.handle ?? null}
                email={account?.email ?? null}
                referralCode={account?.referralCode ?? ""}
                onEarn={onEarn}
              />
            </div>

            {/* Daily */}
            <section>
              <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-4">Daily</div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <CheckinCard
                  status={statusFor(profile?.actions, "daily_checkin")}
                  streak={account?.checkinStreak ?? 0}
                  def={defFor("daily_checkin")}
                  onEarn={onEarn}
                />
                <SpinCard
                  status={statusFor(profile?.actions, "spin_wheel")}
                  def={defFor("spin_wheel")}
                  onEarn={onEarn}
                />
                <MineCard
                  status={statusFor(profile?.actions, "click_to_mine")}
                  def={defFor("click_to_mine")}
                  onEarn={onEarn}
                />
              </div>
            </section>

            {/* Games */}
            <section>
              <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-4">Games</div>
              <div className="grid gap-6 lg:grid-cols-3">
                <TriviaCard
                  prompt={gamesQ.data?.trivia}
                  status={statusFor(profile?.actions, "daily_trivia")}
                  def={defFor("daily_trivia")}
                  onEarn={onEarn}
                />
                <GuessCard
                  prompt={gamesQ.data?.guess}
                  status={statusFor(profile?.actions, "guess_gpu_price")}
                  def={defFor("guess_gpu_price")}
                  onEarn={onEarn}
                />
                <QuizCard
                  prompt={gamesQ.data?.quiz}
                  status={statusFor(profile?.actions, "gpu_quiz")}
                  def={defFor("gpu_quiz")}
                  onEarn={onEarn}
                />
              </div>
            </section>

            {/* Social */}
            <section>
              <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-4">Social</div>
              <SocialCard actions={profile?.actions} defs={actionDefs} onEarn={onEarn} />
            </section>

            {/* Staking */}
            <section>
              <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-4">Staking · Off-chain points</div>
              <StakingPanel
                isAuthed={isAuthed}
                walletAddress={walletAddress}
                onChange={refresh}
              />
            </section>

            {/* History + leaderboard */}
            <div className="grid gap-6 lg:grid-cols-2">
              <HistoryCard history={profile?.history} />
              <LeaderboardCard
                entries={leaderboardQ.data}
                meWallet={walletAddress}
                meHandle={account?.handle ?? null}
              />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ────────────────────────── Launch event: 10 challenges ────────────────────────── */
function ChallengesSection({
  isAuthed,
  walletAddress,
}: {
  isAuthed: boolean;
  walletAddress: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const walletScope = isAuthed ? (walletAddress ?? "anonymous") : "anonymous";
  const challengesQueryKey = [
    ...getGetChallengesQueryKey(),
    walletScope,
  ] as const;
  const challengesQ = useGetChallenges({ query: { queryKey: challengesQueryKey } });
  const claim = useClaimChallenge();
  const [claiming, setClaiming] = useState<string | null>(null);

  const rows = challengesQ.data ?? [];

  // Progression order: tier 10 (easiest) through tier 1 (grand finisher).
  const ordered = [...rows].sort((a: ChallengeView, b: ChallengeView) => b.order - a.order);
  const isDone = (c: ChallengeView) => c.myStatus === "claimed" || c.slotsRemaining === 0;
  const upNext = ordered.filter((c) => !isDone(c));
  const completedCount = ordered.length - upNext.length;
  const visible = upNext.slice(0, 2);

  async function go(key: string) {
    setClaiming(key);
    try {
      const res = await claim.mutateAsync({ key });
      toast({ title: "Slot claimed", description: `You're #${res.rank} on this challenge. Rewards are paid out manually after the event.` });
      queryClient.invalidateQueries({ queryKey: challengesQueryKey });
    } catch (err) {
      toast({
        title: "Couldn't claim",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setClaiming(null);
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Launch event · 10 challenges</div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {completedCount}/{ordered.length} done · harder challenges pay more, fewer slots
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {rows.length > 0 && visible.length === 0 && (
          <div className={cn(CARD, "p-5 text-center")}>
            <DoneTag label="All 10 challenges cleared" />
          </div>
        )}
        {visible.map((c: ChallengeView) => (
          <div key={c.key} className={cn(CARD, "p-4 flex flex-col sm:flex-row sm:items-center gap-3")}>
            <span className="font-mono text-[10px] tracking-widest uppercase text-primary shrink-0 sm:w-16">
              Tier {c.order}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono font-bold text-[13px] tracking-wide uppercase">{c.title}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{c.description}</span>
              </div>
              <p className="font-mono text-[10px] text-primary mt-0.5">{c.rewardNote}</p>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
              {c.slotsClaimed}/{c.slots} slots
            </span>
            <div className="shrink-0 sm:w-40">
              {c.myStatus === "claimed" ? (
                <DoneTag label={`Claimed · #${c.myRank}`} />
              ) : c.myStatus === "full" || c.slotsRemaining === 0 ? (
                <span className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground">Slots full</span>
              ) : !isAuthed ? (
                <span className="font-mono text-[11px] text-muted-foreground">Sign in to claim</span>
              ) : c.myStatus === "eligible" ? (
                <PrimaryBtn onClick={() => go(c.key)} busy={claiming === c.key} className="w-full">Claim slot</PrimaryBtn>
              ) : (
                <span className="font-mono text-[10px] text-muted-foreground leading-relaxed">{c.myReason}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────── Hackathon: 10 technical missions ────────────────────────── */
function MissionsSection({
  isAuthed,
  walletAddress,
}: {
  isAuthed: boolean;
  walletAddress: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const walletScope = isAuthed ? (walletAddress ?? "anonymous") : "anonymous";
  const missionsQueryKey = [
    ...getGetMissionsQueryKey(),
    walletScope,
  ] as const;
  const missionsQ = useGetMissions({ query: { queryKey: missionsQueryKey } });
  const submit = useSubmitMission();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [writeup, setWriteup] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);

  const rows = missionsQ.data ?? [];

  function openForm(m: MissionView) {
    setOpenKey(m.key);
    setProofUrl(m.myProofUrl ?? "");
    setWriteup(m.myWriteup ?? "");
  }

  async function go(key: string) {
    if (!proofUrl.trim() && !writeup.trim()) {
      toast({ title: "Add proof", description: "Submit a link, a write-up, or both.", variant: "destructive" });
      return;
    }
    setSubmitting(key);
    try {
      await submit.mutateAsync({
        key,
        data: { proofUrl: proofUrl.trim() || undefined, writeup: writeup.trim() || undefined },
      });
      toast({ title: "Submitted", description: "Your mission is in for review. Rewards are paid out manually after approval." });
      queryClient.invalidateQueries({ queryKey: missionsQueryKey });
      setOpenKey(null);
    } catch (err) {
      toast({
        title: "Couldn't submit",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Hackathon · 10 technical missions</div>
        <div className="font-mono text-[11px] text-muted-foreground">Build against our servers, submit proof, get reviewed</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {rows.map((m: MissionView) => (
          <div key={m.key} className={cn(CARD, "p-5 flex flex-col")}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] tracking-widest uppercase text-primary">Tier {m.order}</span>
            </div>
            <div className="font-mono font-bold text-[13px] tracking-wide uppercase mb-1">{m.title}</div>
            <p className="font-mono text-[11px] text-muted-foreground mb-3 leading-relaxed flex-1">{m.description}</p>
            <p className="font-mono text-[10px] text-primary mb-3">{m.rewardNote}</p>

            {m.myStatus === "approved" ? (
              <DoneTag label="Approved" />
            ) : m.myStatus === "pending" ? (
              <span className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground">Under review</span>
            ) : !isAuthed ? (
              <span className="font-mono text-[11px] text-muted-foreground">Sign in to submit</span>
            ) : openKey === m.key ? (
              <div className="space-y-2">
                {m.myStatus === "rejected" && m.myReviewNote && (
                  <p className="font-mono text-[10px] text-destructive leading-relaxed">Rejected: {m.myReviewNote}</p>
                )}
                <input
                  value={proofUrl}
                  onChange={(e) => setProofUrl(e.target.value)}
                  placeholder="Link (repo, gist, demo)"
                  className="w-full text-[12px] font-mono border border-border rounded-md bg-background px-2 py-1.5"
                />
                <textarea
                  value={writeup}
                  onChange={(e) => setWriteup(e.target.value)}
                  placeholder="Write-up (optional if you gave a link)"
                  rows={3}
                  className="w-full text-[12px] font-mono border border-border rounded-md bg-background px-2 py-1.5"
                />
                <div className="flex gap-2">
                  <PrimaryBtn onClick={() => go(m.key)} busy={submitting === m.key} className="flex-1">Submit</PrimaryBtn>
                  <button
                    onClick={() => setOpenKey(null)}
                    className="font-mono text-[11px] text-muted-foreground px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {m.myStatus === "rejected" && m.myReviewNote && (
                  <p className="font-mono text-[10px] text-destructive mb-2 leading-relaxed">Rejected: {m.myReviewNote}</p>
                )}
                <PrimaryBtn onClick={() => openForm(m)} className="w-full">
                  {m.myStatus === "rejected" ? "Resubmit" : "Submit proof"}
                </PrimaryBtn>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────── Gate ────────────────────────── */
function Gate({
  connected, canSign, signingIn, signIn, error,
}: {
  connected: boolean;
  canSign: boolean;
  signingIn: boolean;
  signIn: () => Promise<boolean>;
  error: string | null;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-8 sm:p-12 max-w-xl mx-auto mt-12 shadow-sm">
      <Gift className="h-10 w-10 text-primary mb-6" />
      <h2 className="font-bold text-3xl tracking-tight mb-3">
        {connected ? "Sign in to start earning" : "Connect your wallet"}
      </h2>
      <p className="text-base text-muted-foreground leading-relaxed mb-8">
        {connected
          ? "Sign a free message to prove you own this wallet. It's off-chain and won't move any funds."
          : "Your Cookie Run points balance is tracked per wallet. Connect your wallet to begin."}
      </p>

      {!connected ? (
        <ConnectWalletButton className="bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-8 rounded-full font-semibold inline-flex items-center gap-2 transition-colors w-full sm:w-auto justify-center" />
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => void signIn()}
            disabled={!canSign || signingIn}
            data-testid="button-sign-in"
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-8 rounded-full font-semibold inline-flex items-center gap-2 disabled:opacity-50 transition-colors w-full sm:w-auto justify-center"
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
              This wallet can't sign messages. Try a wallet that supports message signing.
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-destructive mt-4">{error}</p>}
    </div>
  );
}

/* ────────────────────────── Balance hero ────────────────────────── */
function BalanceHero({
  balance, handle, wallet,
}: {
  balance: string;
  handle: string | null;
  wallet: string | null;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-8 lg:col-span-2 flex flex-col justify-between shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Your balance</span>
        <Coins className="h-6 w-6 text-primary" />
      </div>
      <div className="my-8">
        <div className="font-bold text-5xl sm:text-7xl tracking-tight tabular-nums text-foreground">
          {fmt(balance)} <span className="text-primary text-2xl sm:text-4xl">pts</span>
        </div>
      </div>
      <div className="text-sm font-medium text-muted-foreground">
        {handle ? <span className="text-foreground">{handle}</span> : "Anonymous miner"}
        {wallet && <span className="ml-2">· {short(wallet)}</span>}
      </div>
    </div>
  );
}

/* ────────────────────────── Profile ────────────────────────── */
function ProfileCard({
  handle, email, referralCode, onEarn,
}: {
  handle: string | null;
  email: string | null;
  referralCode: string;
  onEarn: (e: EarnResult) => void;
}) {
  const { toast } = useToast();
  const [h, setH] = useState(handle ?? "");
  const [e, setE] = useState(email ?? "");
  const update = useUpdateRewardProfile();

  useEffect(() => { setH(handle ?? ""); }, [handle]);
  useEffect(() => { setE(email ?? ""); }, [email]);

  const refLink = useMemo(() => {
    if (typeof window === "undefined" || !referralCode) return "";
    return `${window.location.origin}${import.meta.env.BASE_URL}rewards?ref=${referralCode}`;
  }, [referralCode]);

  async function save() {
    try {
      await update.mutateAsync({
        data: {
          handle: h.trim() ? h.trim() : undefined,
          email: e.trim() ? e.trim() : undefined,
        },
      });
      toast({ title: "Profile saved", description: "Handle & email updated." });
      // Profile changes may credit add_email / complete_profile; refresh balances.
      onEarn({ credited: false, alreadyEarned: false, amount: 0, balance: "0", message: "" });
    } catch (err) {
      toast({
        title: "Couldn't save",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  }

  function copyRef() {
    if (!refLink) return;
    navigator.clipboard?.writeText(refLink).then(
      () => toast({ title: "Referral link copied", description: "Share it to earn when friends sign in." }),
      () => toast({ title: "Copy failed", description: refLink }),
    );
  }

  return (
    <div className={CARD}>
      <div className={cn(SECTION_LABEL, "mb-3")}>Profile</div>
      <label className="block font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-1">Handle</label>
      <input
        value={h}
        onChange={(ev) => setH(ev.target.value)}
        placeholder="leaderboard name"
        maxLength={24}
        className="w-full bg-background font-mono text-[13px] px-3 py-2 mb-3 outline-none focus:border-primary border border-white/10"
      />
      <label className="block font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-1">Email</label>
      <input
        type="email"
        value={e}
        onChange={(ev) => setE(ev.target.value)}
        placeholder="you@domain.com"
        className="w-full bg-background font-mono text-[13px] px-3 py-2 mb-4 outline-none focus:border-primary border border-white/10"
      />
      <PrimaryBtn onClick={save} busy={update.isPending} className="w-full">
        Save profile
      </PrimaryBtn>

      {referralCode && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Referral</span>
            <Share2 className="h-3.5 w-3.5 text-primary" />
          </div>
          <button onClick={copyRef}
            className="w-full text-left font-mono text-[11px] text-primary truncate hover:underline">
            {referralCode}
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── Daily check-in ────────────────────────── */
function CheckinCard({
  status, streak, def, onEarn,
}: {
  status: ActionStatus | undefined;
  streak: number;
  def: RewardAction | undefined;
  onEarn: (e: EarnResult) => void;
}) {
  const claim = useClaimDailyCheckin();
  const available = status?.available ?? true;

  async function go() {
    try {
      const res = await claim.mutateAsync();
      onEarn(res.earn);
    } catch (err) {
      if (err instanceof Error) onEarn({ credited: false, alreadyEarned: false, amount: 0, balance: "0", message: err.message });
    }
  }

  return (
    <GameCard icon={<Flame className="h-4 w-4" />} title="Daily check-in" amount={def?.amount} cadence={def?.cadence}>
      <p className="font-mono text-[12px] text-muted-foreground mb-4 leading-relaxed">
        Streak <span className="text-primary font-bold">{streak}</span> day{streak === 1 ? "" : "s"} — longer streaks pay more.
      </p>
      {available ? (
        <PrimaryBtn onClick={go} busy={claim.isPending} className="w-full">Check in</PrimaryBtn>
      ) : (
        <div className="flex items-center justify-between">
          <DoneTag label="Checked in" />
          <span className="font-mono text-[11px] text-muted-foreground">{countdown(status?.nextAvailableAt)}</span>
        </div>
      )}
    </GameCard>
  );
}

/* ────────────────────────── Spin ────────────────────────── */
function SpinCard({
  status, def, onEarn,
}: {
  status: ActionStatus | undefined;
  def: RewardAction | undefined;
  onEarn: (e: EarnResult) => void;
}) {
  const claim = useClaimSpin();
  const [won, setWon] = useState<number | null>(null);
  const available = status?.available ?? true;

  async function go() {
    try {
      const res = await claim.mutateAsync();
      setWon(res.amount);
      onEarn(res.earn);
    } catch (err) {
      if (err instanceof Error) onEarn({ credited: false, alreadyEarned: false, amount: 0, balance: "0", message: err.message });
    }
  }

  return (
    <GameCard icon={<Dice5 className="h-4 w-4" />} title="Spin the wheel" amount={def?.amount} cadence={def?.cadence}>
      <div className="h-12 flex items-center mb-3">
        <AnimatePresence mode="wait">
          {won != null ? (
            <motion.div key={won} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="font-bold text-2xl text-primary tabular-nums">
              +{fmt(won)} pts
            </motion.div>
          ) : (
            <motion.p key="idle" className="font-mono text-[12px] text-muted-foreground leading-relaxed">
              One free spin a day. Win 10–500 points.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      {available ? (
        <PrimaryBtn onClick={go} busy={claim.isPending} className="w-full">Spin</PrimaryBtn>
      ) : (
        <div className="flex items-center justify-between">
          <DoneTag label="Spun" />
          <span className="font-mono text-[11px] text-muted-foreground">{countdown(status?.nextAvailableAt)}</span>
        </div>
      )}
    </GameCard>
  );
}

/* ────────────────────────── Mine ────────────────────────── */
function MineCard({
  status, def, onEarn,
}: {
  status: ActionStatus | undefined;
  def: RewardAction | undefined;
  onEarn: (e: EarnResult) => void;
}) {
  const claim = useClaimMine();
  const [nextAt, setNextAt] = useState<string | null>(status?.nextAvailableAt ?? null);
  const [, setTick] = useState(0);

  useEffect(() => { setNextAt(status?.nextAvailableAt ?? null); }, [status?.nextAvailableAt]);

  // Drive the cooldown countdown.
  useEffect(() => {
    if (!nextAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [nextAt]);

  const cooling = nextAt ? new Date(nextAt).getTime() > Date.now() : false;

  async function go() {
    try {
      const res = await claim.mutateAsync();
      setNextAt(res.nextAvailableAt ?? null);
      onEarn(res.earn);
    } catch (err) {
      if (err instanceof Error) onEarn({ credited: false, alreadyEarned: false, amount: 0, balance: "0", message: err.message });
    }
  }

  return (
    <GameCard icon={<Pickaxe className="h-4 w-4" />} title="Click to mine" amount={def?.amount}>
      <p className="font-mono text-[12px] text-muted-foreground mb-4 leading-relaxed">
        Tap the rig to earn a small number of points on a short cooldown.
      </p>
      {cooling ? (
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground">Cooling down</span>
          <span className="font-mono text-[11px] text-primary tabular-nums">{countdown(nextAt)}</span>
        </div>
      ) : (
        <PrimaryBtn onClick={go} busy={claim.isPending} className="w-full">Mine points</PrimaryBtn>
      )}
    </GameCard>
  );
}

/* ────────────────────────── Trivia ────────────────────────── */
function TriviaCard({
  prompt, status, def, onEarn,
}: {
  prompt: { id: number; prompt: string; choices: string[] } | undefined;
  status: ActionStatus | undefined;
  def: RewardAction | undefined;
  onEarn: (e: EarnResult) => void;
}) {
  const submit = useSubmitTrivia();
  const [choice, setChoice] = useState<number | null>(null);
  const [result, setResult] = useState<boolean | null>(null);
  const available = status?.available ?? true;

  async function go() {
    if (choice == null) return;
    try {
      const res = await submit.mutateAsync({ data: { choice } });
      setResult(res.correct);
      onEarn(res.earn);
    } catch (err) {
      if (err instanceof Error) onEarn({ credited: false, alreadyEarned: false, amount: 0, balance: "0", message: err.message });
    }
  }

  return (
    <GameCard icon={<HelpCircle className="h-4 w-4" />} title="Daily trivia" amount={def?.amount} cadence={def?.cadence}>
      {!available ? (
        <div className="flex items-center justify-between">
          <DoneTag label="Answered" />
          <span className="font-mono text-[11px] text-muted-foreground">{countdown(status?.nextAvailableAt)}</span>
        </div>
      ) : !prompt ? (
        <p className="font-mono text-[12px] text-muted-foreground">Loading question…</p>
      ) : (
        <>
          <p className="font-mono text-[12px] mb-3 leading-relaxed">{prompt.prompt}</p>
          <div className="space-y-2 mb-4">
            {prompt.choices.map((c, i) => (
              <button key={i} onClick={() => setChoice(i)}
                className={cn(
                  "w-full text-left font-mono text-[12px] px-3 py-2 transition-colors border",
                  choice === i ? "text-primary border-primary" : "text-muted-foreground hover:text-foreground border-white/10",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          {result == null ? (
            <PrimaryBtn onClick={go} busy={submit.isPending} disabled={choice == null} className="w-full">Submit</PrimaryBtn>
          ) : (
            <DoneTag label={result ? "Correct!" : "Submitted"} />
          )}
        </>
      )}
    </GameCard>
  );
}

/* ────────────────────────── Price guess ────────────────────────── */
function GuessCard({
  prompt, status, def, onEarn,
}: {
  prompt: { gpuModel: string; hint?: string } | undefined;
  status: ActionStatus | undefined;
  def: RewardAction | undefined;
  onEarn: (e: EarnResult) => void;
}) {
  const submit = useSubmitPriceGuess();
  const [guess, setGuess] = useState("");
  const [result, setResult] = useState<{ actualUsd: string; withinPct: number } | null>(null);
  const available = status?.available ?? true;

  async function go() {
    const g = parseFloat(guess);
    if (!prompt || !isFinite(g) || g <= 0) return;
    try {
      const res = await submit.mutateAsync({ data: { gpuModel: prompt.gpuModel, guessUsd: g } });
      setResult({ actualUsd: res.actualUsd, withinPct: res.withinPct });
      onEarn(res.earn);
    } catch (err) {
      if (err instanceof Error) onEarn({ credited: false, alreadyEarned: false, amount: 0, balance: "0", message: err.message });
    }
  }

  return (
    <GameCard icon={<Target className="h-4 w-4" />} title="Guess GPU price" amount={def?.amount} cadence={def?.cadence}>
      {!available ? (
        <div className="flex items-center justify-between">
          <DoneTag label="Guessed" />
          <span className="font-mono text-[11px] text-muted-foreground">{countdown(status?.nextAvailableAt)}</span>
        </div>
      ) : !prompt ? (
        <p className="font-mono text-[12px] text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="font-mono text-[12px] mb-1 leading-relaxed">
            Hourly rate for <span className="text-primary">{prompt.gpuModel}</span>?
          </p>
          {prompt.hint && <p className="font-mono text-[11px] text-muted-foreground mb-3">{prompt.hint}</p>}
          {result ? (
            <div className="font-mono text-[12px] mb-3">
              Actual <span className="text-primary">${result.actualUsd}/hr</span> · within {result.withinPct}%
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-3 mt-2">
              <span className="font-mono text-[13px] text-muted-foreground">$</span>
              <input
                type="number" step="0.01" min="0" value={guess}
                onChange={(ev) => setGuess(ev.target.value)} placeholder="0.34"
                className="w-full bg-background font-mono text-[13px] px-3 py-2 outline-none focus:border-primary border border-white/10"
              />
            </div>
          )}
          {result ? (
            <DoneTag label="Submitted" />
          ) : (
            <PrimaryBtn onClick={go} busy={submit.isPending} disabled={!guess} className="w-full">Submit guess</PrimaryBtn>
          )}
        </>
      )}
    </GameCard>
  );
}

/* ────────────────────────── Quiz ────────────────────────── */
function QuizCard({
  prompt, status, def, onEarn,
}: {
  prompt: { questions: { id: number; prompt: string; choices: string[] }[] } | undefined;
  status: ActionStatus | undefined;
  def: RewardAction | undefined;
  onEarn: (e: EarnResult) => void;
}) {
  const submit = useSubmitQuiz();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<{ correct: number; total: number; passed: boolean } | null>(null);
  const available = status?.available ?? true;
  const questions = prompt?.questions ?? [];
  const allAnswered = questions.length > 0 && questions.every((q, i) => answers[i] != null);

  async function go() {
    if (!allAnswered) return;
    const ordered = questions.map((_, i) => answers[i]);
    try {
      const res = await submit.mutateAsync({ data: { answers: ordered } });
      setResult({ correct: res.correct, total: res.total, passed: res.passed });
      onEarn(res.earn);
    } catch (err) {
      if (err instanceof Error) onEarn({ credited: false, alreadyEarned: false, amount: 0, balance: "0", message: err.message });
    }
  }

  return (
    <GameCard icon={<Brain className="h-4 w-4" />} title="GPU quiz" amount={def?.amount}>
      {!available ? (
        <DoneTag label="Passed" />
      ) : !prompt ? (
        <p className="font-mono text-[12px] text-muted-foreground">Loading quiz…</p>
      ) : result ? (
        <div className="font-mono text-[12px]">
          <div className={cn("font-bold text-lg mb-1", result.passed ? "text-primary" : "text-foreground")}>
            {result.correct}/{result.total} correct
          </div>
          <p className="text-muted-foreground">{result.passed ? "Passed — bonus credited." : "Try again tomorrow."}</p>
        </div>
      ) : (
        <>
          <div className="space-y-4 mb-4 max-h-64 overflow-y-auto pr-1">
            {questions.map((q, qi) => (
              <div key={q.id}>
                <p className="font-mono text-[12px] mb-2 leading-relaxed">{qi + 1}. {q.prompt}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {q.choices.map((c, ci) => (
                    <button key={ci} onClick={() => setAnswers((a) => ({ ...a, [qi]: ci }))}
                      className={cn(
                        "text-left font-mono text-[11px] px-2 py-1.5 transition-colors border",
                        answers[qi] === ci ? "text-primary border-primary" : "text-muted-foreground hover:text-foreground border-white/10",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <PrimaryBtn onClick={go} busy={submit.isPending} disabled={!allAnswered} className="w-full">Submit quiz</PrimaryBtn>
        </>
      )}
    </GameCard>
  );
}

/* ────────────────────────── Social ────────────────────────── */
const SOCIAL_META: Record<string, { icon: React.ReactNode; url: string }> = {
  x_follow: { icon: <Twitter className="h-4 w-4" />, url: "https://x.com/0xBasilisca" },
  x_share: { icon: <Twitter className="h-4 w-4" />, url: "https://x.com/intent/post?text=Exploring%20Cookie%20Run%20secure%20GPU%20workspaces%20with%20%40CookieRun" },
};

function SocialCard({
  actions, defs, onEarn,
}: {
  actions: ActionStatus[] | undefined;
  defs: RewardAction[] | undefined;
  onEarn: (e: EarnResult) => void;
}) {
  const claim = useClaimSocial();
  const [pending, setPending] = useState<string | null>(null);

  const social = (defs ?? []).filter((d) => d.category === "social");

  async function go(platform: string) {
    const meta = SOCIAL_META[platform];
    if (meta) window.open(meta.url, "_blank", "noopener,noreferrer");
    setPending(platform);
    try {
      const res = await claim.mutateAsync({ data: { platform } });
      onEarn(res);
    } catch (err) {
      if (err instanceof Error) onEarn({ credited: false, alreadyEarned: false, amount: 0, balance: "0", message: err.message });
    } finally {
      setPending(null);
    }
  }

  if (social.length === 0) return null;

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {social.map((d) => {
        const st = statusFor(actions, d.type);
        const done = st ? !st.available : false;
        const meta = SOCIAL_META[d.type];
        return (
          <div key={d.type} className={CARD}>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-primary">{meta?.icon ?? <Share2 className="h-4 w-4" />}</span>
              <span className="font-mono font-bold text-[12px] tracking-wide uppercase">{d.label}</span>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground mb-4 leading-relaxed">{d.description}</p>
            {done && d.cadence === "once" ? (
              <DoneTag />
            ) : (
              <PrimaryBtn onClick={() => go(d.type)} busy={pending === d.type} className="w-full">
                +{fmt(d.amount)} pts <ChevronRight className="h-3.5 w-3.5" />
              </PrimaryBtn>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────────────── Staking ────────────────────────── */
function StakingPanel({
  isAuthed, walletAddress, onChange,
}: {
  isAuthed: boolean;
  walletAddress: string | null;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const walletScope = walletAddress ?? "anonymous";
  const stakesQueryKey = [
    ...getGetMyStakesQueryKey(),
    walletScope,
  ] as const;
  const stakesQ = useGetMyStakes({
    query: { enabled: isAuthed, queryKey: stakesQueryKey },
  });
  const create = useCreateStake();
  const unstakeM = useUnstakeStake();
  const [, setTick] = useState(0);

  const data = stakesQ.data;
  const tiers = useMemo(() => data?.tiers ?? [], [data]);
  const stakes = data?.stakes ?? [];
  const minStake = data?.minStake ?? 100;
  const available = data?.availableBalance ?? "0";
  const lockedTotal = data?.lockedTotal ?? "0";

  const [amount, setAmount] = useState("");
  const [lockDays, setLockDays] = useState<number>(0);
  const [pendingId, setPendingId] = useState<number | null>(null);

  // Default the term to the first tier once tiers load, and keep it valid.
  useEffect(() => {
    if (tiers.length && !tiers.some((t) => t.lockDays === lockDays)) {
      setLockDays(tiers[0].lockDays);
    }
  }, [tiers, lockDays]);

  // Tick once a second so "unlocks in …" labels stay fresh.
  useEffect(() => {
    if (!stakes.some((s) => s.status === "active")) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [stakes]);

  const amt = parseFloat(amount);
  const tier = tiers.find((t) => t.lockDays === lockDays);
  const projectedBonus =
    isFinite(amt) && amt > 0 && tier ? (amt * tier.bonusBps) / 10_000 : 0;

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: stakesQueryKey });
    onChange();
  }, [queryClient, onChange, stakesQueryKey]);

  async function doStake() {
    if (!isFinite(amt) || amt < minStake) {
      toast({
        title: "Amount too low",
        description: `Minimum stake is ${fmt(minStake)} points.`,
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await create.mutateAsync({ data: { amount: amt, lockDays } });
      if (res.ok) {
        toast({ title: "Staked", description: res.message });
        setAmount("");
      } else {
        toast({ title: "Couldn't stake", description: res.message, variant: "destructive" });
      }
      refreshAll();
    } catch (err) {
      toast({
        title: "Couldn't stake",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  }

  async function doUnstake(s: StakeView) {
    if (!s.matured) {
      const ok = window.confirm(
        "This stake is still locked. Unstaking now returns your principal but forfeits the bonus. Continue?",
      );
      if (!ok) return;
    }
    setPendingId(s.id);
    try {
      const res = await unstakeM.mutateAsync({ id: s.id });
      if (res.ok) {
        toast({ title: s.matured ? "Reward claimed" : "Unstaked", description: res.message });
      } else {
        toast({ title: "Couldn't unstake", description: res.message, variant: "destructive" });
      }
      refreshAll();
    } catch (err) {
      toast({
        title: "Couldn't unstake",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  }

  function setMax() {
    const v = Math.floor(parseFloat(available));
    if (isFinite(v) && v > 0) setAmount(String(v));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* Stake form */}
      <div className={cn(CARD, "lg:col-span-1")}>
        <div className="flex items-center gap-2.5 mb-3">
          <Lock className="h-4 w-4 text-primary" />
          <span className="font-mono font-bold text-[13px] tracking-wide uppercase">Stake Points</span>
        </div>
        <p className="font-mono text-[12px] text-muted-foreground mb-4 leading-relaxed">
          Lock earned points for a fixed term to earn a flat bonus. Locked points still count toward the
          leaderboard. Unstaking early returns your principal but forfeits the bonus.
        </p>

        <label className="block font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-1">Amount</label>
        <input
          value={amount}
          onChange={(ev) => setAmount(ev.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder={`min ${fmt(minStake)}`}
          className="w-full bg-background font-mono text-[13px] px-3 py-2 outline-none focus:border-primary"
          style={{ border: "1px solid rgba(255,255,255,0.12)" }}
        />
        <div className="flex items-center justify-between font-mono text-[11px] mt-1.5 mb-4">
          <span className="text-muted-foreground">
            Available <span className="text-foreground tabular-nums">{fmt(available)}</span>
          </span>
          <button onClick={setMax} className="text-primary tracking-widest uppercase hover:underline">Max</button>
        </div>

        <label className="block font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-1.5">Lock term</label>
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          {tiers.map((t) => (
            <button
              key={t.lockDays}
              onClick={() => setLockDays(t.lockDays)}
              className={cn(
                "p-2 font-mono text-center transition-colors border",
                lockDays === t.lockDays ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-white/10",
              )}
            >
              <div className="text-[14px] font-bold leading-none">+{t.bonusBps / 100}%</div>
              <div className="text-[10px] tracking-widest uppercase opacity-80 mt-1">{t.lockDays}d</div>
            </button>
          ))}
        </div>

        {projectedBonus > 0 && (
          <p className="font-mono text-[11px] text-muted-foreground mb-3">
            Unlocks in {lockDays}d · bonus{" "}
            <span className="text-primary font-bold tabular-nums">+{fmt(projectedBonus)}</span> pts
          </p>
        )}

        <PrimaryBtn onClick={doStake} busy={create.isPending} className="w-full">
          <Lock className="h-3.5 w-3.5" /> Stake Points
        </PrimaryBtn>
      </div>

      {/* Positions */}
      <div className={cn(CARD, "lg:col-span-2")}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Layers className="h-4 w-4 text-primary" />
            <span className="font-mono font-bold text-[13px] tracking-wide uppercase">Your stakes</span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">
            Locked <span className="text-primary font-bold tabular-nums">{fmt(lockedTotal)}</span> pts
          </span>
        </div>

        {stakes.length === 0 ? (
          <p className="font-mono text-[12px] text-muted-foreground">
            No stakes yet — lock some points to start earning a bonus.
          </p>
        ) : (
          <ul className="space-y-1">
            {stakes.map((s) => {
              const active = s.status === "active";
              const rewardPaid = parseFloat(s.rewardPaid ?? "0");
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-2.5 border-b border-white/10"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[13px] font-bold tabular-nums">{fmt(s.amount)} pts</div>
                    <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                      {s.lockDays}d · +{s.bonusBps / 100}% bonus
                    </div>
                  </div>

                  <div className="text-right font-mono text-[11px] whitespace-nowrap">
                    {active ? (
                      s.matured ? (
                        <span className="text-primary">Ready · +{fmt(s.pendingReward)} pts</span>
                      ) : (
                        <span className="text-muted-foreground">Unlocks in {unlockLabel(s.unlockAt)}</span>
                      )
                    ) : (
                      <span className="text-muted-foreground">
                        Unstaked{rewardPaid > 0 ? ` · +${fmt(rewardPaid)} pts` : ""}
                      </span>
                    )}
                  </div>

                  {active ? (
                    <PrimaryBtn
                      onClick={() => void doUnstake(s)}
                      busy={pendingId === s.id}
                      className={cn("px-3 py-2", !s.matured && "!bg-background !text-foreground")}
                    >
                      {s.matured ? (
                        <>
                          <Unlock className="h-3.5 w-3.5" /> Claim
                        </>
                      ) : (
                        "Unstake"
                      )}
                    </PrimaryBtn>
                  ) : (
                    <DoneTag label="Closed" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────── History ────────────────────────── */
const HISTORY_LABELS: Record<string, string> = {
  stake_lock: "Staked",
  stake_unlock: "Unstaked",
  stake_reward: "Staking bonus",
};

function historyLabel(type: string): string {
  return HISTORY_LABELS[type] ?? type.replace(/_/g, " ");
}

function HistoryCard({
  history,
}: {
  history: { id: number; actionType: string; amount: string; createdAt: string }[] | undefined;
}) {
  return (
    <div className={CARD}>
      <div className={cn(SECTION_LABEL, "mb-4")}>Recent earnings</div>
      {!history || history.length === 0 ? (
        <p className="font-mono text-[12px] text-muted-foreground">No earnings yet — claim your first reward above.</p>
      ) : (
        <ul className="space-y-2">
          {history.slice(0, 12).map((h) => {
            const v = parseFloat(h.amount);
            const neg = v < 0;
            return (
              <li key={h.id} className="flex items-center justify-between font-mono text-[12px] py-1.5 border-b border-white/10">
                <span className="text-muted-foreground uppercase tracking-wide">{historyLabel(h.actionType)}</span>
                <span className={cn("font-bold tabular-nums", neg ? "text-muted-foreground" : "text-primary")}>
                  {neg ? "−" : "+"}{fmt(Math.abs(v))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ────────────────────────── Leaderboard ────────────────────────── */
function LeaderboardCard({
  entries, meWallet, meHandle,
}: {
  entries: { rank: number; name: string; balance: string }[] | undefined;
  meWallet: string | null;
  meHandle: string | null;
}) {
  const mineName = meHandle || (meWallet ? short(meWallet) : "");
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-4 w-4 text-primary" />
        <span className={SECTION_LABEL}>Leaderboard</span>
      </div>
      {!entries || entries.length === 0 ? (
        <p className="font-mono text-[12px] text-muted-foreground">No earners ranked yet. Be the first.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const isMe = mineName && e.name === mineName;
            return (
              <li key={e.rank}
                className={cn("flex items-center justify-between font-mono text-[12px] py-1.5 border-b border-white/10", isMe && "text-primary")}
              >
                <span className="flex items-center gap-3">
                  <span className="text-muted-foreground tabular-nums w-6">#{e.rank}</span>
                  <span>{e.name}{isMe ? " (you)" : ""}</span>
                </span>
                <span className="font-bold tabular-nums">{fmt(e.balance)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
