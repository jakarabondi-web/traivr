import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { failMpesaPayout, settleMpesaPayout } from "@/server/services/payouts";

function authorized(request: NextRequest) {
  const expected = process.env.MPESA_CALLBACK_SECRET;
  const supplied = request.nextUrl.searchParams.get("token") ?? "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    Result?: { ResultCode?: number | string; ResultDesc?: string; ConversationID?: string; TransactionID?: string };
  } | null;
  const result = body?.Result;
  if (!result?.ConversationID) return NextResponse.json({ ok: false }, { status: 400 });
  const code = Number(result.ResultCode);
  if (code === 0) {
    await settleMpesaPayout({ providerReference: result.ConversationID, transactionId: result.TransactionID });
  } else {
    await failMpesaPayout({ providerReference: result.ConversationID, reason: result.ResultDesc ?? "M-Pesa settlement failed." });
  }
  return NextResponse.json({ ok: true });
}
