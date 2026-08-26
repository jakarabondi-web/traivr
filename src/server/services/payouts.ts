import { prisma } from "@/lib/db/prisma";
import { getPayoutProvider } from "@/lib/payments";
import { decryptFieldOrLegacy } from "@/lib/security/field-encryption";
import { postPayoutPaid } from "@/server/services/ledger";

export class PayoutError extends Error {}

/**
 * Approves and executes a payout request against its provider.
 * Marks the covered earnings PAID on success, or releases them back to the
 * wallet on failure so the trainer can retry.
 */
export async function processPayoutRequest(params: {
  payoutRequestId: string;
  actorId: string;
}): Promise<{ status: "PAID" | "FAILED"; mocked: boolean; detail: string }> {
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
  const destination =
    request.provider === "MPESA"
      ? request.paymentAccount.mpesaPhoneNumber
        ? decryptFieldOrLegacy(request.paymentAccount.mpesaPhoneNumber)
        : ""
      : request.paymentAccount.externalId ?? "";

  const result = await provider.send({
    payoutRequestId: request.id,
    amountCents: request.amountCents,
    currency: "USD",
    destination,
    reference: `traivr_payout_${request.id}`,
  });

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
