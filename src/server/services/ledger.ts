import { Prisma, type LedgerAccount, type LedgerDirection } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

/**
 * Double-entry ledger.
 *
 * Every money event on the platform posts exactly one balanced transaction
 * to the journal: the sum of DEBIT lines equals the sum of CREDIT lines,
 * always. The journal is append-only — corrections post reversing
 * transactions rather than editing history — so it is the audit trail that
 * answers "what exactly went out or came in, when, and why".
 *
 * Account model (five accounts, deliberately minimal):
 *
 *   CASH                — money the platform actually holds
 *   ACCOUNTS_RECEIVABLE — money clients owe us (invoiced, unpaid)
 *   CLIENT_REVENUE      — revenue earned from client work
 *   TRAINER_PAYABLE     — money we owe trainers (approved, unpaid earnings)
 *   TRAINER_COST        — cost of trainer work
 *
 * Postings:
 *
 *   earning.approved   DR TRAINER_COST      / CR TRAINER_PAYABLE
 *   earning.reversed   DR TRAINER_PAYABLE   / CR TRAINER_COST
 *   payout.paid        DR TRAINER_PAYABLE   / CR CASH
 *   invoice.sent       DR ACCOUNTS_RECEIVABLE / CR CLIENT_REVENUE
 *   invoice.paid       DR CASH              / CR ACCOUNTS_RECEIVABLE
 *   invoice.voided     DR CLIENT_REVENUE    / CR ACCOUNTS_RECEIVABLE
 *                      (only when voided after being sent; a draft that is
 *                      voided never touched the ledger)
 *
 * Idempotency: (sourceType, sourceId, kind) is unique, so replaying an event
 * — a retried request, a re-run backfill — records nothing twice.
 */

export class LedgerError extends Error {}

/** A Prisma client or interactive-transaction client — postings always run
 *  inside the same transaction as the domain change they record. */
export type LedgerClient = Prisma.TransactionClient;

export type LedgerEntryInput = {
  account: LedgerAccount;
  direction: LedgerDirection;
  amountCents: number;
};

export type PostTransactionInput = {
  kind: string;
  description: string;
  sourceType: "Earning" | "PayoutRequest" | "Invoice";
  sourceId: string;
  actorId?: string | null;
  userId?: string | null;
  organizationId?: string | null;
  occurredAt?: Date;
  lines: LedgerEntryInput[];
};

/**
 * Post one balanced transaction to the journal.
 *
 * Validates that the entry balances (debits === credits) and that every
 * amount is positive before writing anything. If this exact event was
 * already posted, the unique constraint fires and the existing transaction
 * stands — posting is safe to retry.
 *
 * Returns the created transaction, or null when the event was already
 * posted (idempotent replay).
 */
export async function postTransaction(tx: LedgerClient, input: PostTransactionInput) {
  if (input.lines.length < 2) {
    throw new LedgerError("A ledger transaction needs at least one debit and one credit line.");
  }
  let debits = 0;
  let credits = 0;
  for (const line of input.lines) {
    if (!Number.isInteger(line.amountCents) || line.amountCents <= 0) {
      throw new LedgerError("Every ledger line needs a positive whole number of cents.");
    }
    if (line.direction === "DEBIT") debits += line.amountCents;
    else credits += line.amountCents;
  }
  if (debits !== credits) {
    throw new LedgerError(
      `Unbalanced ledger transaction for ${input.kind}: debits ${debits} != credits ${credits}.`
    );
  }

  // Idempotency check up front: replaying an already-posted event is a
  // clean no-op. Checking first (rather than only catching P2002) matters
  // because postings run inside the caller's transaction, and a failed
  // insert would abort that whole transaction on Postgres.
  const existing = await tx.ledgerTransaction.findUnique({
    where: {
      sourceType_sourceId_kind: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        kind: input.kind,
      },
    },
    select: { id: true },
  });
  if (existing) return null;

  try {
    return await tx.ledgerTransaction.create({
      data: {
        kind: input.kind,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        actorId: input.actorId ?? null,
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        lines: {
          create: input.lines.map((line) => ({
            account: line.account,
            direction: line.direction,
            amountCents: line.amountCents,
          })),
        },
      },
      include: { lines: true },
    });
  } catch (error) {
    // P2002 on (sourceType, sourceId, kind): this event is already in the
    // journal. That's the idempotency working, not a failure.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Posting helpers — one per money event, so call sites stay one-liners and
// the debit/credit mapping lives in exactly one file.
// ---------------------------------------------------------------------------

export function postEarningApproved(
  tx: LedgerClient,
  params: {
    earningId: string;
    userId: string;
    amountCents: number;
    actorId?: string | null;
    description?: string;
    occurredAt?: Date;
  }
) {
  return postTransaction(tx, {
    kind: "earning.approved",
    description: params.description ?? "Trainer earning approved",
    sourceType: "Earning",
    sourceId: params.earningId,
    actorId: params.actorId,
    userId: params.userId,
    occurredAt: params.occurredAt,
    lines: [
      { account: "TRAINER_COST", direction: "DEBIT", amountCents: params.amountCents },
      { account: "TRAINER_PAYABLE", direction: "CREDIT", amountCents: params.amountCents },
    ],
  });
}

export function postEarningReversed(
  tx: LedgerClient,
  params: {
    earningId: string;
    userId: string;
    amountCents: number;
    actorId?: string | null;
    description?: string;
    occurredAt?: Date;
  }
) {
  return postTransaction(tx, {
    kind: "earning.reversed",
    description: params.description ?? "Trainer earning reversed",
    sourceType: "Earning",
    sourceId: params.earningId,
    actorId: params.actorId,
    userId: params.userId,
    occurredAt: params.occurredAt,
    lines: [
      { account: "TRAINER_PAYABLE", direction: "DEBIT", amountCents: params.amountCents },
      { account: "TRAINER_COST", direction: "CREDIT", amountCents: params.amountCents },
    ],
  });
}

export function postPayoutPaid(
  tx: LedgerClient,
  params: {
    payoutRequestId: string;
    userId: string;
    amountCents: number;
    actorId?: string | null;
    description?: string;
    occurredAt?: Date;
  }
) {
  return postTransaction(tx, {
    kind: "payout.paid",
    description: params.description ?? "Trainer payout sent",
    sourceType: "PayoutRequest",
    sourceId: params.payoutRequestId,
    actorId: params.actorId,
    userId: params.userId,
    occurredAt: params.occurredAt,
    lines: [
      { account: "TRAINER_PAYABLE", direction: "DEBIT", amountCents: params.amountCents },
      { account: "CASH", direction: "CREDIT", amountCents: params.amountCents },
    ],
  });
}

export function postInvoiceSent(
  tx: LedgerClient,
  params: {
    invoiceId: string;
    organizationId: string;
    amountCents: number;
    actorId?: string | null;
    description?: string;
    occurredAt?: Date;
  }
) {
  return postTransaction(tx, {
    kind: "invoice.sent",
    description: params.description ?? "Invoice issued to client",
    sourceType: "Invoice",
    sourceId: params.invoiceId,
    actorId: params.actorId,
    organizationId: params.organizationId,
    occurredAt: params.occurredAt,
    lines: [
      { account: "ACCOUNTS_RECEIVABLE", direction: "DEBIT", amountCents: params.amountCents },
      { account: "CLIENT_REVENUE", direction: "CREDIT", amountCents: params.amountCents },
    ],
  });
}

export function postInvoicePaid(
  tx: LedgerClient,
  params: {
    invoiceId: string;
    organizationId: string;
    amountCents: number;
    actorId?: string | null;
    description?: string;
    occurredAt?: Date;
  }
) {
  return postTransaction(tx, {
    kind: "invoice.paid",
    description: params.description ?? "Client payment received",
    sourceType: "Invoice",
    sourceId: params.invoiceId,
    actorId: params.actorId,
    organizationId: params.organizationId,
    occurredAt: params.occurredAt,
    lines: [
      { account: "CASH", direction: "DEBIT", amountCents: params.amountCents },
      { account: "ACCOUNTS_RECEIVABLE", direction: "CREDIT", amountCents: params.amountCents },
    ],
  });
}

/** Reverses invoice.sent. Only call for an invoice that was actually sent —
 *  a draft that is voided never reached the ledger. */
export function postInvoiceVoided(
  tx: LedgerClient,
  params: {
    invoiceId: string;
    organizationId: string;
    amountCents: number;
    actorId?: string | null;
    description?: string;
    occurredAt?: Date;
  }
) {
  return postTransaction(tx, {
    kind: "invoice.voided",
    description: params.description ?? "Invoice voided after sending",
    sourceType: "Invoice",
    sourceId: params.invoiceId,
    actorId: params.actorId,
    organizationId: params.organizationId,
    occurredAt: params.occurredAt,
    lines: [
      { account: "CLIENT_REVENUE", direction: "DEBIT", amountCents: params.amountCents },
      { account: "ACCOUNTS_RECEIVABLE", direction: "CREDIT", amountCents: params.amountCents },
    ],
  });
}

// ---------------------------------------------------------------------------
// Queries — the admin "money movement" view reads from here.
// ---------------------------------------------------------------------------

export type AccountBalance = {
  account: LedgerAccount;
  debitCents: number;
  creditCents: number;
  /** Signed balance in the account's natural direction: positive for a
   *  debit-normal account (CASH, AR, TRAINER_COST) means net debits;
   *  positive for a credit-normal account (CLIENT_REVENUE,
   *  TRAINER_PAYABLE) means net credits. */
  balanceCents: number;
};

const DEBIT_NORMAL: LedgerAccount[] = ["CASH", "ACCOUNTS_RECEIVABLE", "TRAINER_COST"];

export async function getAccountBalances(): Promise<AccountBalance[]> {
  const grouped = await prisma.ledgerLine.groupBy({
    by: ["account", "direction"],
    _sum: { amountCents: true },
  });

  const accounts: LedgerAccount[] = [
    "CASH",
    "ACCOUNTS_RECEIVABLE",
    "CLIENT_REVENUE",
    "TRAINER_PAYABLE",
    "TRAINER_COST",
  ];

  return accounts.map((account) => {
    const debitCents =
      grouped.find((g) => g.account === account && g.direction === "DEBIT")?._sum.amountCents ?? 0;
    const creditCents =
      grouped.find((g) => g.account === account && g.direction === "CREDIT")?._sum.amountCents ?? 0;
    const balanceCents = DEBIT_NORMAL.includes(account)
      ? debitCents - creditCents
      : creditCents - debitCents;
    return { account, debitCents, creditCents, balanceCents };
  });
}

/**
 * Trial balance: total debits vs total credits across the whole journal.
 * In a healthy double-entry ledger these are always equal — this is the
 * reconciliation proof the admin view surfaces as a badge.
 */
export async function getTrialBalance() {
  const grouped = await prisma.ledgerLine.groupBy({
    by: ["direction"],
    _sum: { amountCents: true },
  });
  const debitCents = grouped.find((g) => g.direction === "DEBIT")?._sum.amountCents ?? 0;
  const creditCents = grouped.find((g) => g.direction === "CREDIT")?._sum.amountCents ?? 0;
  return { debitCents, creditCents, balanced: debitCents === creditCents };
}

export type MoneyMovementFilter = {
  kind?: string;
  account?: LedgerAccount;
  from?: Date;
  to?: Date;
  limit?: number;
};

/**
 * The journal, newest first, with lines and enough context (trainer /
 * organization names) to read each posting without leaving the page.
 */
export async function getMoneyMovement(filter: MoneyMovementFilter = {}) {
  const where: Prisma.LedgerTransactionWhereInput = {};
  if (filter.kind) where.kind = filter.kind;
  if (filter.account) where.lines = { some: { account: filter.account } };
  if (filter.from || filter.to) {
    where.occurredAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }

  const transactions = await prisma.ledgerTransaction.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: Math.min(filter.limit ?? 100, 500),
    include: { lines: true },
  });

  // Resolve names in two batched lookups instead of per-row joins.
  const userIds = [...new Set(transactions.map((t) => t.userId).filter((v): v is string => !!v))];
  const orgIds = [
    ...new Set(transactions.map((t) => t.organizationId).filter((v): v is string => !!v)),
  ];
  const [users, orgs] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
        })
      : Promise.resolve([]),
    orgIds.length
      ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const userById = new Map(
    users.map((u) => [
      u.id,
      u.displayName || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
    ])
  );
  const orgById = new Map(orgs.map((o) => [o.id, o.name]));

  return transactions.map((t) => ({
    ...t,
    counterparty: t.userId
      ? userById.get(t.userId) ?? null
      : t.organizationId
        ? orgById.get(t.organizationId) ?? null
        : null,
  }));
}

/**
 * Roll-up numbers for the money-movement header: what has come in, what has
 * gone out, and what is still owed in each direction.
 */
export async function getLedgerSummary() {
  const balances = await getAccountBalances();
  const byAccount = new Map(balances.map((b) => [b.account, b]));

  const cash = byAccount.get("CASH");
  const receivable = byAccount.get("ACCOUNTS_RECEIVABLE");
  const payable = byAccount.get("TRAINER_PAYABLE");
  const revenue = byAccount.get("CLIENT_REVENUE");
  const cost = byAccount.get("TRAINER_COST");

  return {
    /** Client payments actually received. */
    cashInCents: cash?.debitCents ?? 0,
    /** Trainer payouts actually sent. */
    cashOutCents: cash?.creditCents ?? 0,
    /** Net cash position. */
    netCashCents: cash?.balanceCents ?? 0,
    /** Invoiced but not yet paid by clients. */
    receivableCents: receivable?.balanceCents ?? 0,
    /** Owed to trainers, not yet paid out. */
    trainerPayableCents: payable?.balanceCents ?? 0,
    /** Lifetime revenue recognized. */
    revenueCents: revenue?.balanceCents ?? 0,
    /** Lifetime trainer cost recognized. */
    trainerCostCents: cost?.balanceCents ?? 0,
  };
}
