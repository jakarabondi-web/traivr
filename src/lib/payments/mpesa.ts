import type { PayoutProvider, PayoutRequestInput, PayoutResult } from "./types";
import { appUrl } from "@/lib/app-url";

/**
 * M-Pesa payouts via Safaricom's Daraja B2C API.
 *
 * Disabled until explicit KES settlement amounts and authenticated result
 * callbacks are wired. Missing credentials never produce a fake success.
 * Going live additionally requires a registered Safaricom business shortcode
 * and an initiator account with B2C permissions; those cannot be self-served.
 */

const DARAJA_BASE =
  process.env.MPESA_ENVIRONMENT === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

function credentials() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const initiatorName = process.env.MPESA_INITIATOR_NAME;
  const securityCredential = process.env.MPESA_SECURITY_CREDENTIAL;

  if (!consumerKey || !consumerSecret || !shortcode || !initiatorName || !securityCredential) {
    return null;
  }
  return { consumerKey, consumerSecret, shortcode, initiatorName, securityCredential };
}

async function fetchAccessToken(consumerKey: string, consumerSecret: string): Promise<string> {
  const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const res = await fetch(`${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) throw new Error(`M-Pesa auth failed (${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("M-Pesa auth response missing access_token");
  return json.access_token;
}

/** M-Pesa expects a 2547XXXXXXXX MSISDN, not +254 or 07XX formats. */
export function normalizeMpesaPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

export const mpesaProvider: PayoutProvider = {
  key: "MPESA",
  label: "M-Pesa",

  isMocked() {
    return credentials() === null;
  },

  async send(input: PayoutRequestInput): Promise<PayoutResult> {
    const creds = credentials();

    const msisdn = normalizeMpesaPhone(input.destination);
    if (!msisdn) {
      return { ok: false, failureReason: "Invalid M-Pesa phone number", mocked: creds === null };
    }

    if (!creds) {
      return { ok: false, failureReason: "M-Pesa is not configured for real payouts.", mocked: true };
    }

    if (input.currency !== "KES") {
      return { ok: false, failureReason: "M-Pesa payouts require an explicit KES amount.", mocked: false };
    }

    const token = await fetchAccessToken(creds.consumerKey, creds.consumerSecret);
    const callbackBase = appUrl();

    // Daraja B2C amounts are in whole KES, not cents.
    const res = await fetch(`${DARAJA_BASE}/mpesa/b2c/v1/paymentrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        InitiatorName: creds.initiatorName,
        SecurityCredential: creds.securityCredential,
        CommandID: "BusinessPayment",
        Amount: Math.round(input.amountCents / 100),
        PartyA: creds.shortcode,
        PartyB: msisdn,
        Remarks: input.reference,
        QueueTimeOutURL: `${callbackBase}/api/webhooks/mpesa/timeout`,
        ResultURL: `${callbackBase}/api/webhooks/mpesa/result`,
        Occasion: input.payoutRequestId,
      }),
    });

    const json = (await res.json()) as {
      ConversationID?: string;
      ResponseCode?: string;
      errorMessage?: string;
      ResponseDescription?: string;
    };

    if (!res.ok || json.ResponseCode !== "0" || !json.ConversationID) {
      return {
        ok: false,
        failureReason: json.errorMessage ?? json.ResponseDescription ?? `M-Pesa B2C failed (${res.status})`,
        mocked: false,
      };
    }

    // The caller only supports settled payouts. Until authenticated result
    // handling exists, do not report an asynchronous acceptance as paid.
    return {
      ok: false,
      failureReason: "M-Pesa accepted the request but settlement callbacks are not enabled; no payout was recorded.",
      mocked: false,
    };
  },
};
