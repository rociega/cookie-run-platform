// ForgeRun transactional email: branded templates + Resend transport.
//
// The transport (getResendClient) is wired through the Replit Resend connector.
// Templates are plain inline-styled HTML so they render in every mail client.
import { logger } from "./logger";
import { RESEND_FROM_EMAIL, ADMIN_EMAIL } from "./config";
import { getResendClient, isResendConfigured } from "./resendClient";

const ACCENT = "#a6f2ff";
const BG = "#050508";
const CARD = "#0c0c11";
const MUTED = "#8a8a92";
const MONO = "'Courier New', ui-monospace, SFMono-Regular, Menlo, monospace";

function layout(heading: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:92%;background:${CARD};border:1px solid rgba(255,255,255,0.12);border-top:2px solid ${ACCENT};">
        <tr><td style="padding:24px 28px;border-bottom:1px solid rgba(255,255,255,0.08);">
          <span style="font-family:${MONO};font-size:18px;font-weight:bold;letter-spacing:2px;color:#ffffff;">FORGERUN</span>
          <span style="font-family:${MONO};font-size:11px;color:${MUTED};letter-spacing:1px;"> // EPHEMERAL COMPUTE PLATFORM</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-family:${MONO};font-size:22px;color:#ffffff;font-weight:bold;">${heading}</h1>
          <div style="font-family:${MONO};font-size:14px;line-height:1.6;color:#d4d4d4;">${body}</div>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid rgba(255,255,255,0.08);font-family:${MONO};font-size:11px;color:${MUTED};">
          Verified NVIDIA GPU capacity, settled on Solana · Automated message from ForgeRun.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function chip(text: string): string {
  return `<span style="display:inline-block;background:rgba(166,242,255,0.08);border:1px solid rgba(166,242,255,0.35);color:${ACCENT};padding:3px 8px;font-family:${MONO};font-size:12px;">${text}</span>`;
}

// Escape user-controlled values before interpolating them into HTML emails.
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function whitelistConfirmationEmail(email: string): string {
  return layout(
    "You're on the whitelist.",
    `<p>Welcome to the edge of the network.</p>
     <p><b style="color:#fff;">${esc(email)}</b> is registered for early access to ForgeRun compute. You'll be among the first to provision verified NVIDIA capacity and settle on-chain.</p>
     <p style="margin-top:20px;">${chip("STATUS: WHITELISTED")}</p>`,
  );
}

export function walletWelcomeEmail(address: string): string {
  const short = address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  return layout(
    "Wallet connected.",
    `<p>Your Solana wallet is now linked to ForgeRun.</p>
     <p>Connected address: <b style="color:#fff;">${esc(short)}</b></p>
     <p>You can now rent GPUs and settle payments directly from your wallet — no intermediaries.</p>
     <p style="margin-top:20px;">${chip("WALLET: LINKED")}</p>`,
  );
}

export function rentalConfirmationEmail(rental: {
  id: number;
  gpuModel: string;
  durationHours: number;
  priceUsd: string;
  solAmount: string;
  currency?: string | null;
  tokenAmount?: string | null;
  vastInstanceId: string | null;
  status: string;
}): string {
  const instance = rental.vastInstanceId
    ? `<p>Instance ID: <b style="color:#fff;">${esc(rental.vastInstanceId)}</b> — your node is provisioning now.</p>`
    : "";
  const paid =
    rental.currency === "ICPX"
      ? `${esc(rental.tokenAmount ?? "0")} ICPX ($${esc(rental.priceUsd)})`
      : `${esc(rental.solAmount)} SOL ($${esc(rental.priceUsd)})`;
  return layout(
    "GPU rental confirmed.",
    `<p>Payment received and verified on-chain. Your compute is being allocated.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;font-family:${MONO};font-size:13px;color:#d4d4d4;">
       <tr><td style="padding:6px 0;color:${MUTED};">Order</td><td style="text-align:right;color:#fff;">#${rental.id}</td></tr>
       <tr><td style="padding:6px 0;color:${MUTED};">GPU</td><td style="text-align:right;color:#fff;">${esc(rental.gpuModel)}</td></tr>
       <tr><td style="padding:6px 0;color:${MUTED};">Duration</td><td style="text-align:right;color:#fff;">${rental.durationHours}h</td></tr>
       <tr><td style="padding:6px 0;color:${MUTED};">Paid</td><td style="text-align:right;color:${ACCENT};">${paid}</td></tr>
       <tr><td style="padding:6px 0;color:${MUTED};">Status</td><td style="text-align:right;color:#fff;">${esc(rental.status.toUpperCase())}</td></tr>
     </table>
     ${instance}
     <p style="margin-top:20px;">${chip("PAYMENT: VERIFIED")}</p>`,
  );
}

export function earnEmail(args: {
  label: string;
  amount: number;
  balance: string;
  note?: string;
}): string {
  return layout(
    `+${args.amount} ForgeRun points earned`,
    `<p>You just earned <b style="color:${ACCENT};">${args.amount} ForgeRun points</b> for:</p>
     <p style="margin:6px 0 16px;">${chip(esc(args.label))}</p>
     ${args.note ? `<p>${esc(args.note)}</p>` : ""}
     <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;font-family:${MONO};font-size:13px;color:#d4d4d4;">
       <tr><td style="padding:6px 0;color:${MUTED};">Earned</td><td style="text-align:right;color:${ACCENT};">+${args.amount} points</td></tr>
       <tr><td style="padding:6px 0;color:${MUTED};">New balance</td><td style="text-align:right;color:#fff;">${esc(args.balance)} points</td></tr>
     </table>
     <p style="color:${MUTED};font-size:12px;line-height:1.6;">Daily check-ins, quizzes, trivia and referrals all add to your balance. ForgeRun points are an off-chain platform balance — they are not a token and carry no redemption promise.</p>`,
  );
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<boolean> {
  if (!isResendConfigured()) {
    logger.warn({ to, subject }, "Resend not configured; skipping email send");
    return false;
  }
  try {
    const resend = await getResendClient();
    const { error } = await resend.emails.send({ from: RESEND_FROM_EMAIL, to, subject, html });
    if (error) {
      logger.error({ err: error, to, subject }, "Resend reported an error sending email");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, "Failed to send email");
    return false;
  }
}

export async function notifyAdmin(subject: string, html: string): Promise<boolean> {
  if (!ADMIN_EMAIL) {
    logger.info({ subject }, "ICPX_ADMIN_EMAIL not set; skipping admin notification");
    return false;
  }
  return sendEmail({ to: ADMIN_EMAIL, subject, html: layout(subject, html) });
}
