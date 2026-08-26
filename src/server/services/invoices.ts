import type { Invoice } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  postInvoicePaid,
  postInvoiceSent,
  postInvoiceVoided,
  type LedgerClient,
} from "@/server/services/ledger";

export class InvoiceError extends Error {}

/**
 * Assigns the next sequential invoice number (INV-0001, INV-0002, …).
 * Runs inside the send transaction so two invoices sent at once can't get
 * the same number — the unique constraint on Invoice.number backstops it.
 */
async function nextInvoiceNumber(tx: LedgerClient): Promise<string> {
  const last = await tx.invoice.findFirst({
    where: { number: { not: null } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = last?.number ? parseInt(last.number.replace(/\D/g, ""), 10) : 0;
  return `INV-${String(lastSeq + 1).padStart(4, "0")}`;
}

async function transition(params: {
  invoiceId: string;
  actorId: string;
  from: ("DRAFT" | "SENT" | "PAID" | "OVERDUE" | "VOID")[];
  to: "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "VOID";
  action: string;
  extra?: Record<string, unknown>;
  /** Posts the matching ledger entry inside the same transaction, so an
   *  invoice's status and the books can never disagree. */
  post?: (tx: LedgerClient, invoice: Invoice) => Promise<unknown>;
}) {
  const invoice = await prisma.invoice.findUnique({ where: { id: params.invoiceId } });
  if (!invoice) throw new InvoiceError("That invoice no longer exists.");
  if (!params.from.includes(invoice.status)) {
    throw new InvoiceError(`An invoice in ${invoice.status.toLowerCase()} status can't be moved to ${params.to.toLowerCase()}.`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id: params.invoiceId },
      data: { status: params.to, ...(params.extra ?? {}) },
    });

    if (params.post) await params.post(tx, invoice);

    await tx.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        entityType: "Invoice",
        entityId: params.invoiceId,
      },
    });

    return updated;
  });
}

export async function markInvoiceSent(params: { invoiceId: string; actorId: string }) {
  return transition({
    ...params,
    from: ["DRAFT"],
    to: "SENT",
    action: "invoice.sent",
    post: async (tx, invoice) => {
      // Issue the invoice number at send time — drafts stay unnumbered so
      // the sequence has no gaps from drafts that never go out.
      if (!invoice.number) {
        const number = await nextInvoiceNumber(tx);
        await tx.invoice.update({ where: { id: invoice.id }, data: { number } });
      }
      if (invoice.amountCents > 0) {
        await postInvoiceSent(tx, {
          invoiceId: invoice.id,
          organizationId: invoice.organizationId,
          amountCents: invoice.amountCents,
          actorId: params.actorId,
        });
      }
    },
  });
}

export function markInvoicePaid(params: { invoiceId: string; actorId: string }) {
  return transition({
    ...params,
    from: ["SENT", "OVERDUE"],
    to: "PAID",
    action: "invoice.paid",
    extra: { paidAt: new Date() },
    post: async (tx, invoice) => {
      if (invoice.amountCents > 0) {
        await postInvoicePaid(tx, {
          invoiceId: invoice.id,
          organizationId: invoice.organizationId,
          amountCents: invoice.amountCents,
          actorId: params.actorId,
        });
      }
    },
  });
}

export function voidInvoice(params: { invoiceId: string; actorId: string }) {
  return transition({
    ...params,
    from: ["DRAFT", "SENT"],
    to: "VOID",
    action: "invoice.voided",
    post: async (tx, invoice) => {
      // Only a sent invoice ever reached the ledger; voiding a draft has
      // nothing to reverse.
      if (invoice.status === "SENT" && invoice.amountCents > 0) {
        await postInvoiceVoided(tx, {
          invoiceId: invoice.id,
          organizationId: invoice.organizationId,
          amountCents: invoice.amountCents,
          actorId: params.actorId,
        });
      }
    },
  });
}
