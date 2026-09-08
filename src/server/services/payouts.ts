import { prisma } from "@/lib/db/prisma";
import { getPayoutProvider } from "@/lib/payments";
import { decryptFieldOrLegacy } from "@/lib/security/field-encryption";
import { postPayoutPaid } from "@/server/services/ledger";

export class PayoutError extends Error {}

function mpesaProviderAmount(amountCents: number): number | null {
  const rate = Number(process.env.MPESA_USD_TO_KES_RATE);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const amount = Math.round((amountCents / 100) * rate);
  return amount > 0 ? amount : null;
}

/**
 * Approves and executes a payout request against its provider.
 * Marks the covered earnings PAID on success, or releases them back to the
 * wallet on failure so the trainer can retry.
 */
export async function processPayoutRequest(params: {
  payoutRequestId: string;
  actorId: string;
}): Promise<{ status: "PAID" | "FAILED" | "PROCESSING"; mocked: boolean; detail: string }> {
  const request = await prisma.payoutRequest.findUnique({
    where: { id: params.payoutRequestId },
    include: { paymentAccount: true, user: true },
  });

  if (!request) throw new PayoutError("Payout request not found.");
  if (request.status !== "REQUESTED" && request.status !== "APPROVED") {
    throw new PayoutError(`Payout request is already ${request.status.toLowerCase()}.`);
  }

  await prisma.payoutRequest.update({
    where: { id: request.id },
    data: { status: "PROCESSING", processedBy: params.actorId },
  });

  const provider = getPayoutProvider(request.provider);
  const providerAmount = request.provider === "MPESA" ? mpesaProviderAmount(request.amountCents) : undefined;
  if (request.provider === "MPESA" && providerAmount === null) {
    await prisma.payoutRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", processedBy: null, failureReason: "M-Pesa exchange rate is not configured." },
    });
    throw new PayoutError("M-Pesa payouts require MPESA_USD_TO_KES_RATE before they can be issued.");
  }
  const destination =
    request.provider === "MPESA"
      ? request.paymentAccount.mpesaPhoneNumber
        ? decryptFieldOrLegacy(request.paymentAccount.mpesaPhoneNumber)
        : ""
      : request.paymentAccount.externalId ?? "";

  const result = await provider.send({
    payoutRequestId: request.id,
    amountCents: request.amountCents,
    // M-Pesa is intentionally disabled until its KES settlement amount is
    // explicitly recorded; USD cents must never be reinterpreted as KES.
    currency: request.provider === "MPESA" ? "KES" : "USD",
    providerAmount: providerAmount ?? undefined,
    destination,
    reference: `traivr_payout_${request.id}`,
  });

  if (result.ok === "pending") {
    await prisma.payoutRequest.update({
      where: { id: request.id },
      data: { status: "PROCESSING", providerReference: result.providerReference },
    });
    return { status: "PROCESSING", mocked: false, detail: `Provider accepted payout ${result.providerReference}; awaiting settlement callback.` };
  }

  if (!result.ok) {
    await prisma.$transaction([
      prisma.payoutRequest.update({
        where: { id: request.id },
        data: { status: "FAILED", failureReason: result.failureReason, processedAt: new Date() },
      }),
      // Release the earnings so the trainer can request again.
      prisma.earning.updateMany({
        where: { payoutRequestId: request.id },
        data: { payoutRequestId: null },
      }),
      prisma.notification.create({
        data: {
          userId: request.userId,
          type: "payout_failed",
          title: "Payout failed",
          body: `${result.failureReason} Your earnings are available to request again.`,
          link: "/trainer/payments",
        },
      }),
      prisma.auditLog.create({
        data: {
          actorId: params.actorId,
          action: "payout.failed",
          entityType: "PayoutRequest",
          entityId: request.id,
          metadata: { reason: result.failureReason, mocked: result.mocked },
        },
      }),
    ]);
    return { status: "FAILED", mocked: result.mocked, detail: result.failureReason };
  }

  await prisma.$transaction(async (tx) => {
    await tx.payoutRequest.update({
      where: { id: request.id },
      data: { status: "PAID", providerReference: result.providerReference, processedAt: new Date() },
    });
    await tx.earning.updateMany({
      where: { payoutRequestId: request.id },
      data: { status: "PAID" },
    });
    // Cash actually left the platform — book it in the same transaction
    // that marks the payout paid, so the journal can never disagree with
    // the payout's status.
    await postPayoutPaid(tx, {
      payoutRequestId: request.id,
      userId: request.userId,
      amountCents: request.amountCents,
      actorId: params.actorId,
      description: `Payout via ${provider.label} (${result.providerReference})`,
    });
    await tx.notification.create({
      data: {
        userId: request.userId,
        type: "payout_sent",
        title: "Payout sent",
        body: `${(request.amountCents / 100).toFixed(2)} was sent via ${provider.label}.`,
        link: "/trainer/payments",
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: params.actorId,
        action: "payout.paid",
        entityType: "PayoutRequest",
        entityId: request.id,
        metadata: {
          amountCents: request.amountCents,
          provider: request.provider,
          providerReference: result.providerReference,
          mocked: result.mocked,
        },
      },
    });
  });

  return { status: "PAID", mocked: result.mocked, detail: result.providerReference };
}

export async function settleMpesaPayout(params: { providerReference: string; transactionId?: string }) {
  const request = await prisma.payoutRequest.findFirst({ where: { providerReference: params.providerReference, provider: "MPESA", status: "PROCESSING" }, include: { user: true } });
  if (!request) return false;
  await prisma.$transaction(async (tx) => {
    await tx.payoutRequest.update({ where: { id: request.id }, data: { status: "PAID", providerReference: params.transactionId ?? params.providerReference, processedAt: new Date() } });
    await tx.earning.updateMany({ where: { payoutRequestId: request.id }, data: { status: "PAID" } });
    await postPayoutPaid(tx, { payoutRequestId: request.id, userId: request.userId, amountCents: request.amountCents, actorId: null, description: `Payout via M-Pesa (${params.transactionId ?? params.providerReference})` });
    await tx.notification.create({ data: { userId: request.userId, type: "payout_sent", title: "Payout sent", body: `${(request.amountCents / 100).toFixed(2)} was sent via M-Pesa.`, link: "/trainer/payments" } });
    await tx.auditLog.create({ data: { actorId: null, action: "payout.paid", entityType: "PayoutRequest", entityId: request.id, metadata: { provider: "MPESA", providerReference: params.providerReference, transactionId: params.transactionId ?? null, callback: true } } });
  });
  return true;
}

export async function failMpesaPayout(params: { providerReference: string; reason: string }) {
  const request = await prisma.payoutRequest.findFirst({ where: { providerReference: params.providerReference, provider: "MPESA", status: "PROCESSING" } });
  if (!request) return false;
  await prisma.$transaction([
    prisma.payoutRequest.update({ where: { id: request.id }, data: { status: "FAILED", failureReason: params.reason, processedAt: new Date() } }),
    prisma.earning.updateMany({ where: { payoutRequestId: request.id }, data: { payoutRequestId: null } }),
    prisma.notification.create({ data: { userId: request.userId, type: "payout_failed", title: "Payout failed", body: `${params.reason} Your earnings are available to request again.`, link: "/trainer/payments" } }),
    prisma.auditLog.create({ data: { actorId: null, action: "payout.failed", entityType: "PayoutRequest", entityId: request.id, metadata: { provider: "MPESA", callback: true, reason: params.reason } } }),
  ]);
  return true;
}

export async function rejectPayoutRequest(params: {
  payoutRequestId: string;
  actorId: string;
  reason: string;
}) {
  const request = await prisma.payoutRequest.findUnique({ where: { id: params.payoutRequestId } });
  if (!request) throw new PayoutError("Payout request not found.");
  if (request.status === "PAID") throw new PayoutError("Cannot reject a payout that has already been paid.");

  await prisma.$transaction([
    prisma.payoutRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        failureReason: params.reason,
        processedAt: new Date(),
        processedBy: params.actorId,
      },
    }),
    prisma.earning.updateMany({ where: { payoutRequestId: request.id }, data: { payoutRequestId: null } }),
    prisma.notification.create({
      data: {
        userId: request.userId,
        type: "payout_rejected",
        title: "Payout request declined",
        body: params.reason,
        link: "/trainer/support",
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: "payout.rejected",
        entityType: "PayoutRequest",
        entityId: request.id,
        metadata: { reason: params.reason },
      },
    }),
  ]);
}
