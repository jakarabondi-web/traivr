"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { assertClearedForTrainerWork, GateError } from "@/server/services/trainer-gate";
import { prisma } from "@/lib/db/prisma";
import { assertCan } from "@/lib/permissions/can";
import { normalizeMpesaPhone } from "@/lib/payments/mpesa";
import { encryptField } from "@/lib/security/field-encryption";
import { requestPayout, WalletError } from "@/server/services/wallet";
import { processPayoutRequest, rejectPayoutRequest, PayoutError } from "@/server/services/payouts";

export type ActionState = { status: "idle" | "success" | "error"; message?: string };

// --- Trainer: add a payout method -----------------------------------------

const addMethodSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("MPESA"), phone: z.string().min(9) }),
  z.object({ provider: z.literal("STRIPE_CONNECT"), accountId: z.string().min(3) }),
]);

export async function addPaymentMethod(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { status: "error", message: "Not signed in." };

  // Payout destinations belong to people cleared to earn. This had no role
  // or gate check at all, so any signed-in account — including a client-org
  // member who can never be paid — could attach one.
  try {
    await assertClearedForTrainerWork(session.user);
  } catch (err) {
    if (err instanceof GateError) return { status: "error", message: err.message };
    throw err;
  }

  const parsed = addMethodSchema.safeParse({
    provider: formData.get("provider"),
    phone: formData.get("phone") ?? undefined,
    accountId: formData.get("accountId") ?? undefined,
  });
  if (!parsed.success) return { status: "error", message: "Check the details and try again." };

  if (parsed.data.provider === "MPESA") {
    const msisdn = normalizeMpesaPhone(parsed.data.phone);
    if (!msisdn) {
      return { status: "error", message: "Enter a valid Kenyan M-Pesa number (e.g. 0712 345 678)." };
    }
    await prisma.paymentAccount.create({
      data: { userId: session.user.id, provider: "MPESA", mpesaPhoneNumber: encryptField(msisdn) },
    });
  } else {
    await prisma.paymentAccount.create({
      data: { userId: session.user.id, provider: "STRIPE_CONNECT", externalId: parsed.data.accountId },
    });
  }

  revalidatePath("/trainer/payments");
  return { status: "success", message: "Payment method added." };
}

// --- Trainer: request a payout --------------------------------------------

export async function submitPayoutRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { status: "error", message: "Not signed in." };

  // requestPayout already refuses without approved earnings, so this is
  // defence in depth rather than the thing standing between an applicant
  // and the money — but an ungated payout endpoint should not exist.
  try {
    await assertClearedForTrainerWork(session.user);
  } catch (err) {
    if (err instanceof GateError) return { status: "error", message: err.message };
    throw err;
  }

  const paymentAccountId = String(formData.get("paymentAccountId") ?? "");
  if (!paymentAccountId) return { status: "error", message: "Choose a payment method." };

  try {
    const { amountCents } = await requestPayout({ userId: session.user.id, paymentAccountId });
    revalidatePath("/trainer/payments");
    revalidatePath("/trainer/earnings");
    return {
      status: "success",
      message: `Payout request for $${(amountCents / 100).toFixed(2)} submitted for review.`,
    };
  } catch (err) {
    if (err instanceof WalletError) return { status: "error", message: err.message };
    throw err;
  }
}

// --- Finance/admin: approve or reject --------------------------------------

export async function approvePayout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { status: "error", message: "Not signed in." };
  assertCan(session.user.roles, "payment.issue");

  const payoutRequestId = String(formData.get("payoutRequestId") ?? "");

  try {
    const result = await processPayoutRequest({ payoutRequestId, actorId: session.user.id });
    revalidatePath("/admin/payments");
    return {
      status: result.status === "PAID" || result.status === "PROCESSING" ? "success" : "error",
      message:
        result.status === "PAID"
          ? `Payout sent${result.mocked ? " (mocked — no provider credentials configured)" : ""}.`
          : result.status === "PROCESSING"
            ? "Payout accepted by the provider and is awaiting settlement."
          : `Payout failed: ${result.detail}`,
    };
  } catch (err) {
    if (err instanceof PayoutError) return { status: "error", message: err.message };
    throw err;
  }
}

export async function declinePayout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { status: "error", message: "Not signed in." };
  assertCan(session.user.roles, "payment.issue");

  const payoutRequestId = String(formData.get("payoutRequestId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { status: "error", message: "A reason is required to decline a payout." };

  try {
    await rejectPayoutRequest({ payoutRequestId, actorId: session.user.id, reason });
    revalidatePath("/admin/payments");
    return { status: "success", message: "Payout request declined." };
  } catch (err) {
    if (err instanceof PayoutError) return { status: "error", message: err.message };
    throw err;
  }
}
