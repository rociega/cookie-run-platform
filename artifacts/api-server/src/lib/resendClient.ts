// Resend transport via the Replit connector proxy (preferred) with a direct
// RESEND_API_KEY fallback. Implemented over the Resend REST API so it needs no
// extra npm dependency and fails soft when not configured.
import { logger } from "./logger";

interface ResendSendArgs {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
}
interface ResendSendResult {
  error: { message: string } | null;
}
export interface MinimalResendClient {
  emails: { send(args: ResendSendArgs): Promise<ResendSendResult> };
}

function replitToken(): string | null {
  if (process.env.REPL_IDENTITY) return `repl ${process.env.REPL_IDENTITY}`;
  if (process.env.WEB_REPL_RENEWAL) return `depl ${process.env.WEB_REPL_RENEWAL}`;
  return null;
}

export function isResendConfigured(): boolean {
  if (process.env.RESEND_API_KEY) return true;
  return Boolean(process.env.REPLIT_CONNECTORS_HOSTNAME && replitToken());
}

async function getResendApiKey(): Promise<string | null> {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const token = replitToken();
  if (!hostname || !token) return null;

  try {
    const res = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=resend`,
      { headers: { Accept: "application/json", X_REPLIT_TOKEN: token } },
    );
    if (!res.ok) {
      logger.error({ status: res.status }, "Resend connector proxy returned an error");
      return null;
    }
    const data = (await res.json()) as {
      items?: Array<{ settings?: { api_key?: string; access_token?: string } }>;
    };
    const settings = data.items?.[0]?.settings;
    return settings?.api_key ?? settings?.access_token ?? null;
  } catch (err) {
    logger.error({ err }, "Failed to fetch Resend credentials from connector proxy");
    return null;
  }
}

export async function getResendClient(): Promise<MinimalResendClient> {
  const apiKey = await getResendApiKey();
  if (!apiKey) throw new Error("Resend API key is unavailable");

  return {
    emails: {
      async send(args: ResendSendArgs): Promise<ResendSendResult> {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { error: { message: `HTTP ${res.status}: ${text.slice(0, 200)}` } };
        }
        return { error: null };
      },
    },
  };
}
