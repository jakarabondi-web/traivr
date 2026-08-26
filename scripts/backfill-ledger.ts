/**
 * Backfills the double-entry ledger from pre-ledger finance records.
 *
 * Safe to re-run: postings are idempotent on (sourceType, sourceId, kind),
 * invoice numbers are only assigned where missing, and synthesized line
 * items are only created for invoices that have none.
 *
 * Run with:
 *   DATABASE_URL=... npx tsx scripts/backfill-ledger.ts
 */
import { prisma } from "../src/lib/db/prisma";
import {
  postEarningApproved,
  postEarningReversed,
  postInvoicePaid,
  postInvoiceSent,
  postPayoutPaid,
  getTrialBalance,
} from "../src/server/services/ledger";

async function backfillEarnings() {
  // Every earning that was ever approved gets its approval on the books;
  // a reversed earning gets both sides so the correction stays visible.
  const earnings = await prisma.earning.findMany({
    where: { status: { in: ["APPROVED", "SCHEDULED", "PROCESSING", "PAID", "REVERSED", "FAILED"] } },
    orderBy: { createdAt: "asc" },
  });

  let approved = 0;
  let reversed = 0;
  for (const earning of earnings) {
    const amount = earning.baseCents + earning.bonusCents + earning.adjustmentCents;
    if (amount <= 0) continue;
    const posted = await prisma.$transaction((tx) =>
      postEarningApproved(tx, {
        earningId: earning.id,
        userId: earning.userId,
        amountCents: amount,
        occurredAt: earning.createdAt,
        description: "Trainer earning approved (backfilled)",
      })
    );
    if (posted) approved += 1;
    if (earning.status === "REVERSED") {
      const postedReversal = await prisma.$transaction((tx) =>
        postEarningReversed(tx, {
          earningId: earning.id,
          userId: earning.userId,
          amountCents: amount,
          occurredAt: earning.createdAt,
          description: "Trainer earning reversed (backfilled)",
        })
      );
      if (postedReversal) reversed += 1;
    }
  }
  console.log(`earnings: ${approved} approvals, ${reversed} reversals posted`);
}

async function backfillPayouts() {
  const payouts = await prisma.payoutRequest.findMany({
    where: { status: "PAID" },
    orderBy: { requestedAt: "asc" },
  });
  let posted = 0;
  for (const payout of payouts) {
    if (payout.amountCents <= 0) continue;
    const result = await prisma.$transaction((tx) =>
      postPayoutPaid(tx, {
        payoutRequestId: payout.id,
        userId: payout.userId,
        amountCents: payout.amountCents,
        actorId: payout.processedBy,
        occurredAt: payout.processedAt ?? payout.requestedAt,
        description: `Payout via ${payout.provider} (backfilled)`,
      })
    );
    if (result) posted += 1;
  }
  console.log(`payouts: ${posted} posted`);
}

async function backfillInvoices() {
  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: "asc" },
    include: { lineItems: true, organization: { select: { name: true } } },
  });

  let numbered = 0;
  let linesCreated = 0;
  let sentPosted = 0;
  let paidPosted = 0;

  // Continue numbering after the highest existing number.
  let seq = invoices.reduce((max, inv) => {
    const n = inv.number ? parseInt(inv.number.replace(/\D/g, ""), 10) : 0;
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  for (const invoice of invoices) {
    // Numbers for every issued (non-draft) invoice, oldest first.
    if (!invoice.number && invoice.status !== "DRAFT") {
      seq += 1;
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { number: `INV-${String(seq).padStart(4, "0")}` },
      });
      numbered += 1;
    }

    // A single synthesized line so no invoice is a bare number with no
    // stated basis. New invoices get real line items going forward.
    if (invoice.lineItems.length === 0 && invoice.amountCents > 0) {
      await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          description: `AI training services — ${invoice.organization.name}`,
          quantity: 1,
          unitCents: invoice.amountCents,
          amountCents: invoice.amountCents,
        },
      });
      linesCreated += 1;
    }

    if (invoice.amountCents <= 0) continue;

    // SENT, OVERDUE and PAID invoices were all issued at some point.
    // VOID is skipped: pre-ledger data can't tell a voided draft (never
    // issued) from a voided sent invoice, and fabricating a receivable
    // plus its reversal adds noise without changing any balance.
    if (["SENT", "OVERDUE", "PAID"].includes(invoice.status)) {
      const posted = await prisma.$transaction((tx) =>
        postInvoiceSent(tx, {
          invoiceId: invoice.id,
          organizationId: invoice.organizationId,
          amountCents: invoice.amountCents,
          occurredAt: invoice.createdAt,
          description: "Invoice issued to client (backfilled)",
        })
      );
      if (posted) sentPosted += 1;
    }
    if (invoice.status === "PAID") {
      const posted = await prisma.$transaction((tx) =>
        postInvoicePaid(tx, {
          invoiceId: invoice.id,
          organizationId: invoice.organizationId,
          amountCents: invoice.amountCents,
          occurredAt: invoice.paidAt ?? invoice.createdAt,
          description: "Client payment received (backfilled)",
        })
      );
      if (posted) paidPosted += 1;
    }
  }
  console.log(
    `invoices: ${numbered} numbered, ${linesCreated} line items synthesized, ${sentPosted} sent + ${paidPosted} paid postings`
  );
}

async function main() {
  await backfillEarnings();
  await backfillPayouts();
  await backfillInvoices();

  const trial = await getTrialBalance();
  console.log(
    `trial balance: debits ${trial.debitCents} / credits ${trial.creditCents} — ${trial.balanced ? "BALANCED" : "OUT OF BALANCE"}`
  );
  if (!trial.balanced) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
