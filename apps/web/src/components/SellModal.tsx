import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  createListing,
  updateListing,
  requestListingUpload,
  finalizeListing,
  useGetComputeTemplates,
  type Listing,
  type ListingInputCategory,
} from "@workspace/api-client-react";
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  UploadCloud,
  FileUp,
} from "lucide-react";
import Modal from "./Modal";
import ConnectWalletButton from "./ConnectWalletButton";
import { useRewardsAuth } from "@/lib/rewardsAuth";
import { useEvmWallet } from "@/lib/wallet";

type Step =
  | "form"
  | "creating"
  | "uploading"
  | "finalizing"
  | "success";

const CATEGORIES: { id: ListingInputCategory; label: string; hint: string }[] = [
  { id: "model", label: "Model / LoRA", hint: "Weights, checkpoints" },
  { id: "dataset", label: "Dataset", hint: "Training data" },
  { id: "template", label: "Template", hint: "Workflows" },
];

export default function SellModal({
  open,
  onClose,
  onCreated,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  editing?: Listing | null;
}) {
  const isEdit = !!editing;
  const { connected } = useEvmWallet();
  const {
    isAuthed,
    canSign,
    signingIn,
    signIn,
    error: authError,
    invalidateSession,
  } = useRewardsAuth();
  const { data: templates } = useGetComputeTemplates();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ListingInputCategory>("model");
  const [price, setPrice] = useState("");
  const [suggestedTemplateId, setSuggestedTemplateId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setDescription(editing?.description ?? "");
      setCategory((editing?.category as ListingInputCategory) ?? "model");
      setPrice(editing?.priceUsd != null ? String(Number(editing.priceUsd)) : "");
      setSuggestedTemplateId(editing?.suggestedTemplateId ?? "");
      setFile(null);
      setStep("form");
      setError(null);
    }
  }, [open, editing]);

  function close() {
    onClose();
    setTimeout(() => {
      setStep("form");
      setError(null);
    }, 250);
  }

  function describeError(e: unknown): string {
    const status = (e as { status?: number })?.status;
    if (status === 401) {
      invalidateSession();
      return "Your session expired — sign in again to list your asset.";
    }
    const msg =
      e && typeof e === "object" && "message" in e
        ? String((e as { message?: unknown }).message ?? "")
        : "";
    return msg || "Something went wrong. Please try again.";
  }

  async function submit() {
    const priceNum = Number(price);
    if (!title.trim()) {
      setError("Give your asset a title.");
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Enter a price in USD.");
      return;
    }

    if (isEdit && editing) {
      setError(null);
      try {
        setStep("finalizing");
        await updateListing(editing.id, {
          title: title.trim(),
          description: description.trim(),
          category,
          priceUsd: priceNum,
        });
        setStep("success");
        onCreated?.();
      } catch (e) {
        setError(describeError(e));
        setStep("form");
      }
      return;
    }

    if (!file) {
      setError("Choose a file to sell.");
      return;
    }

    setError(null);
    let created: Listing | null = null;
    try {
      setStep("creating");
      created = await createListing({
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        priceUsd: priceNum,
        fileName: file.name,
        fileSizeBytes: file.size,
        suggestedTemplateId:
          category === "template" && suggestedTemplateId
            ? suggestedTemplateId
            : undefined,
      });

      setStep("uploading");
      const grant = await requestListingUpload(created.id);
      const res = await fetch(grant.uploadURL, { method: "PUT", body: file });
      if (!res.ok) {
        throw new Error(
          `Upload failed (${res.status}). Please try again with your file.`,
        );
      }

      setStep("finalizing");
      await finalizeListing(created.id);
      setStep("success");
      onCreated?.();
    } catch (e) {
      setError(describeError(e));
      setStep("form");
    }
  }

  const busy =
    step === "creating" || step === "uploading" || step === "finalizing";
  const busyLabel = isEdit
    ? "Saving changes…"
    : step === "creating"
      ? "Creating listing…"
      : step === "uploading"
        ? "Uploading file…"
        : step === "finalizing"
          ? "Finalizing…"
          : "";


  return (
    <Modal
      open={open}
      onClose={close}
      title={isEdit ? "Edit Listing" : "Sell an Asset"}
      maxWidth={500}
    >
      {!isAuthed ? (
        <div>
          <p className="font-mono text-[12px] text-muted-foreground leading-relaxed mb-4">
            {connected
              ? "Sign a free message to prove you own this wallet. Sales pay out as off-chain Cookie Run points to the wallet you sign in with."
              : "Connect your legacy Solana wallet to list an asset. Your earnings are credited to the wallet you sign in with."}
          </p>
          {!connected ? (
            <ConnectWalletButton className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 w-full flex items-center justify-center gap-2" />
          ) : (
            <button
              onClick={() => void signIn()}
              disabled={!canSign || signingIn}
              data-testid="button-sell-sign-in"
              className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {signingIn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {signingIn ? "Check your wallet…" : "Sign in with wallet"}
            </button>
          )}
          {connected && !canSign && (
            <p className="font-mono text-[11px] text-destructive mt-3">
              This wallet can't sign messages. Try Phantom, Solflare, or Backpack.
            </p>
          )}
          {authError && (
            <p className="font-mono text-[11px] text-destructive mt-3">
              {authError}
            </p>
          )}
        </div>
      ) : step === "success" ? (
        <div className="text-center py-2">
          <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-4" />
          <p className="font-black text-[18px] tracking-tight mb-2">
            {isEdit ? "Changes saved." : "Listing is live."}
          </p>
          <p className="font-mono text-[12px] text-muted-foreground leading-relaxed mb-5">
            {isEdit
              ? "Your listing has been updated. The new details are live on the marketplace."
              : "Your asset is now on the marketplace. You will earn Cookie Run points on every sale — track them in My Listings."}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/marketplace?tab=listings"
              onClick={close}
              data-testid="link-my-listings"
              className="premium-btn-ghost font-mono font-bold text-[11px] tracking-widest uppercase px-5 py-2.5"
            >
              View my listings
            </Link>
            <button
              onClick={close}
              data-testid="button-sell-done"
              className="premium-btn font-mono font-bold text-[11px] tracking-widest uppercase px-6 py-2.5"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2">
              Title
            </div>
            <input
              type="text"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. SDXL Cyberpunk LoRA v2"
              data-testid="input-sell-title"
              className="w-full bg-background font-mono text-[13px] px-3 py-2.5 outline-none focus:border-primary border border-white/10"
            />
          </div>

          <div className="mb-4">
            <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2">
              Category
            </div>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((c) => {
                const active = category === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    data-testid={`option-sell-category-${c.id}`}
                    className={cn(
                      "font-mono py-2 transition-colors",
                      active ? "premium-btn" : "premium-btn-ghost text-muted-foreground"
                    )}
                  >
                    <div className="text-[12px] font-bold leading-tight">
                      {c.label}
                    </div>
                    <div className="text-[9px] mt-0.5 opacity-70">{c.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-4">
            <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2">
              Description <span className="opacity-50">(optional)</span>
            </div>
            <textarea
              value={description}
              maxLength={4000}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What it is, how to use it, what's included…"
              data-testid="input-sell-description"
              className="w-full bg-background font-mono text-[12px] px-3 py-2.5 outline-none focus:border-primary resize-none leading-relaxed border border-white/10"
            />
          </div>

          {category === "template" && !isEdit && (
            <div className="mb-4">
              <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2">
                Launchable workload <span className="opacity-50">(optional)</span>
              </div>
              <select
                value={suggestedTemplateId}
                onChange={(e) => setSuggestedTemplateId(e.target.value)}
                data-testid="select-sell-template"
                className="w-full bg-background font-mono text-[12px] px-3 py-2.5 outline-none focus:border-primary border border-white/10"
              >
                <option value="">None — download only</option>
                {(templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="font-mono text-[10px] text-muted-foreground/60 mt-1.5 leading-relaxed">
                Buyers can launch a workspace pre-set to this workload after
                purchase.
              </p>
            </div>
          )}

          <div className="mb-4">
            <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2">
              Price (USD)
            </div>
            <input
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="9.99"
              data-testid="input-sell-price"
              className="w-full bg-background font-mono text-[13px] px-3 py-2.5 outline-none focus:border-primary border border-white/10"
            />
          </div>

          {isEdit ? (
            <div className="mb-5 font-mono text-[10px] text-muted-foreground/60 leading-relaxed">
              The uploaded file can't be changed here. To swap the file, remove
              this listing and create a new one.
            </div>
          ) : (
            <div className="mb-5">
              <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2">
                File
              </div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                data-testid="input-sell-file"
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-sell-choose-file"
                className="w-full flex items-center gap-3 px-3 py-3 font-mono text-[12px] text-left transition-colors hover:border-primary border border-white/10"
              >
                <FileUp className="h-4 w-4 text-primary shrink-0" />
                {file ? (
                  <span className="truncate">
                    {file.name}{" "}
                    <span className="text-muted-foreground/60">
                      ({(file.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Choose a file to sell…
                  </span>
                )}
              </button>
            </div>
          )}

          {error && (
            <p
              className="font-mono text-[11px] text-destructive mb-3"
              data-testid="text-sell-error"
            >
              {error}
            </p>
          )}

          <button
            onClick={() => void submit()}
            disabled={busy}
            data-testid="button-sell-submit"
            className="premium-btn font-mono font-bold text-[12px] tracking-widest uppercase px-6 py-3 w-full disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {busyLabel}
              </>
            ) : isEdit ? (
              <>
                <CheckCircle2 className="h-4 w-4" /> Save changes
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" /> List on marketplace
              </>
            )}
          </button>
          {!isEdit && (
            <p className="mt-3 font-mono text-[10px] text-muted-foreground/50 text-center tracking-wider">
              Your file is stored privately and only released to paid buyers.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
