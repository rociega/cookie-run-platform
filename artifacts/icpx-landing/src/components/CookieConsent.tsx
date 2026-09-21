import { useEffect, useState } from "react";
import { Link } from "wouter";

const CONSENT_KEY = "forgerun-cookie-consent";
type ConsentChoice = "accepted" | "rejected" | "custom";

function readConsent(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(CONSENT_KEY) ?? window.localStorage.getItem("forgerun-cookie-consent");
  return value === "accepted" || value === "rejected" || value === "custom"
    ? value
    : null;
}

export default function CookieConsent() {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    setChoice(readConsent());
  }, []);

  function save(next: ConsentChoice) {
    window.localStorage.setItem(CONSENT_KEY, next);
    setChoice(next);
    setSettingsOpen(false);
  }

  if (choice) return null;

  return (
    <aside
      role="dialog"
      aria-label="Cookie preferences"
      aria-describedby="cookie-consent-copy"
      className="fixed inset-x-4 bottom-4 z-[80] max-h-[calc(100dvh-2rem)] overflow-y-auto max-w-md bg-background border border-foreground p-6 md:inset-x-auto md:right-6 md:bottom-6"
      data-testid="cookie-consent-banner"
    >
      <div className="flex flex-col gap-6">
        <div>
          <div className="mono-label mb-2 font-medium text-foreground">Privacy</div>
          <p id="cookie-consent-copy" className="text-sm leading-relaxed text-muted-foreground">
            We use essential storage to keep the platform working and remember
            your privacy choice. Optional analytics and marketing cookies are
            off by default and are not loaded unless you choose them.
          </p>
        </div>

        {settingsOpen ? (
          <div className="border-y border-border py-4">
            <label className="flex items-start gap-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked
                disabled
                className="mt-0.5 accent-foreground"
                aria-label="Essential storage, always active"
              />
              <span>
                <strong className="text-foreground font-medium">Essential</strong>
                <span className="block text-xs mt-1">
                  Required for security, wallet sessions, and core preferences.
                </span>
              </span>
            </label>
            <label className="mt-4 flex items-start gap-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(event) => setAnalytics(event.target.checked)}
                className="mt-0.5 accent-foreground"
                aria-label="Optional analytics cookies"
              />
              <span>
                <strong className="text-foreground font-medium">Analytics</strong>
                <span className="block text-xs mt-1">
                  Helps us understand aggregate product usage. None are loaded
                  while this remains off.
                </span>
              </span>
            </label>
          </div>
        ) : null}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-4 mono-label">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/cookies" className="hover:text-foreground transition-colors">Cookies</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {settingsOpen ? (
              <button
                type="button"
                onClick={() => save(analytics ? "accepted" : "custom")}
                className="premium-btn"
              >
                Save choices
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => save("rejected")}
                  className="premium-btn-ghost"
                >
                  Reject optional
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="premium-btn-ghost"
                >
                  Manage
                </button>
                <button
                  type="button"
                  onClick={() => save("accepted")}
                  className="premium-btn"
                >
                  Accept all
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
