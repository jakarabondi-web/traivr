import { describe, expect, it, vi, beforeEach } from "vitest";

// The query helpers read through the shared prisma client; postTransaction
// itself takes the transaction client as an argument, so a hand-rolled fake
// covers the posting tests without mocking the module at all.
const ledgerLineGroupBy = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    ledgerLine: { groupBy: (...a: unknown[]) => ledgerLineGroupBy(...a) },
  },
}));

const {
  LedgerError,
  postTransaction,
  postEarningApproved,
  postEarningReversed,
  postPayoutPaid,
  postInvoiceSent,
  postInvoicePaid,
  postInvoiceVoided,
  getTrialBalance,
  getAccountBalances,
} = await import("@/server/services/ledger");

type FakeTx = {
  ledgerTransaction: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function fakeTx(overrides: Partial<FakeTx["ledgerTransaction"]> = {}) {
  return {
    ledgerTransaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "txn-1", ...data })),
      ...overrides,
    },
  } as unknown as Parameters<typeof postTransaction>[0] & FakeTx;
}

beforeEach(() => {
  ledgerLineGroupBy.mockReset();
});

describe("postTransaction — invariants", () => {
  const base = {
    kind: "earning.approved",
    description: "test",
    sourceType: "Earning" as const,
    sourceId: "e-1",
  };

  it("rejects an unbalanced transaction", async () => {
    const tx = fakeTx();
    await expect(
      postTransaction(tx, {
        ...base,
        lines: [
          { account: "TRAINER_COST", direction: "DEBIT", amountCents: 1000 },
          { account: "TRAINER_PAYABLE", direction: "CREDIT", amountCents: 900 },
        ],
      })
    ).rejects.toThrow(LedgerError);
    expect(tx.ledgerTransaction.create).not.toHaveBeenCalled();
  });

  it("rejects zero, negative, and fractional amounts", async () => {
    for (const amountCents of [0, -100, 10.5]) {
      await expect(
        postTransaction(fakeTx(), {
          ...base,
          lines: [
            { account: "TRAINER_COST", direction: "DEBIT", amountCents },
            { account: "TRAINER_PAYABLE", direction: "CREDIT", amountCents },
          ],
        })
      ).rejects.toThrow(LedgerError);
    }
  });

  it("rejects a transaction with fewer than two lines", async () => {
    await expect(
      postTransaction(fakeTx(), {
        ...base,
        lines: [{ account: "CASH", direction: "DEBIT", amountCents: 100 }],
      })
    ).rejects.toThrow(LedgerError);
  });

  it("is idempotent: an already-posted event returns null without writing", async () => {
    const tx = fakeTx({ findUnique: vi.fn().mockResolvedValue({ id: "existing" }) });
    const result = await postTransaction(tx, {
      ...base,
      lines: [
        { account: "TRAINER_COST", direction: "DEBIT", amountCents: 500 },
        { account: "TRAINER_PAYABLE", direction: "CREDIT", amountCents: 500 },
      ],
    });
    expect(result).toBeNull();
    expect(tx.ledgerTransaction.create).not.toHaveBeenCalled();
  });

  it("writes a balanced transaction with its lines", async () => {
    const tx = fakeTx();
    await postTransaction(tx, {
      ...base,
      lines: [
        { account: "TRAINER_COST", direction: "DEBIT", amountCents: 500 },
        { account: "TRAINER_PAYABLE", direction: "CREDIT", amountCents: 500 },
      ],
    });
    const arg = tx.ledgerTransaction.create.mock.calls[0][0];
    expect(arg.data.sourceId).toBe("e-1");
    expect(arg.data.lines.create).toHaveLength(2);
  });
});

describe("posting helpers — debit/credit mapping", () => {
  async function linesFor(post: (tx: ReturnType<typeof fakeTx>) => Promise<unknown>) {
    const tx = fakeTx();
    await post(tx);
    return tx.ledgerTransaction.create.mock.calls[0][0].data.lines.create as Array<{
      account: string;
      direction: string;
      amountCents: number;
    }>;
  }

  it("earning approved: DR trainer cost / CR trainer payable", async () => {
    const lines = await linesFor((tx) =>
      postEarningApproved(tx, { earningId: "e-1", userId: "u-1", amountCents: 700 })
    );
    expect(lines).toEqual([
      { account: "TRAINER_COST", direction: "DEBIT", amountCents: 700 },
      { account: "TRAINER_PAYABLE", direction: "CREDIT", amountCents: 700 },
    ]);
  });

  it("earning reversed is the exact mirror of approved", async () => {
    const lines = await linesFor((tx) =>
      postEarningReversed(tx, { earningId: "e-1", userId: "u-1", amountCents: 700 })
    );
    expect(lines).toEqual([
      { account: "TRAINER_PAYABLE", direction: "DEBIT", amountCents: 700 },
      { account: "TRAINER_COST", direction: "CREDIT", amountCents: 700 },
    ]);
  });

  it("payout paid: DR trainer payable / CR cash — cash actually leaves", async () => {
    const lines = await linesFor((tx) =>
      postPayoutPaid(tx, { payoutRequestId: "p-1", userId: "u-1", amountCents: 5000 })
    );
    expect(lines).toEqual([
      { account: "TRAINER_PAYABLE", direction: "DEBIT", amountCents: 5000 },
      { account: "CASH", direction: "CREDIT", amountCents: 5000 },
    ]);
  });

  it("invoice sent: DR receivable / CR revenue", async () => {
    const lines = await linesFor((tx) =>
      postInvoiceSent(tx, { invoiceId: "i-1", organizationId: "o-1", amountCents: 100_000 })
    );
    expect(lines).toEqual([
      { account: "ACCOUNTS_RECEIVABLE", direction: "DEBIT", amountCents: 100_000 },
      { account: "CLIENT_REVENUE", direction: "CREDIT", amountCents: 100_000 },
    ]);
  });

  it("invoice paid: DR cash / CR receivable — cash actually arrives", async () => {
    const lines = await linesFor((tx) =>
      postInvoicePaid(tx, { invoiceId: "i-1", organizationId: "o-1", amountCents: 100_000 })
    );
    expect(lines).toEqual([
      { account: "CASH", direction: "DEBIT", amountCents: 100_000 },
      { account: "ACCOUNTS_RECEIVABLE", direction: "CREDIT", amountCents: 100_000 },
    ]);
  });

  it("invoice voided reverses invoice sent", async () => {
    const lines = await linesFor((tx) =>
      postInvoiceVoided(tx, { invoiceId: "i-1", organizationId: "o-1", amountCents: 100_000 })
    );
    expect(lines).toEqual([
      { account: "CLIENT_REVENUE", direction: "DEBIT", amountCents: 100_000 },
      { account: "ACCOUNTS_RECEIVABLE", direction: "CREDIT", amountCents: 100_000 },
    ]);
  });
});

describe("trial balance and account balances", () => {
  it("reports balanced when total debits equal total credits", async () => {
    ledgerLineGroupBy.mockResolvedValue([
      { direction: "DEBIT", _sum: { amountCents: 12_345 } },
      { direction: "CREDIT", _sum: { amountCents: 12_345 } },
    ]);
    const trial = await getTrialBalance();
    expect(trial).toEqual({ debitCents: 12_345, creditCents: 12_345, balanced: true });
  });

  it("reports out of balance the moment they diverge", async () => {
    ledgerLineGroupBy.mockResolvedValue([
      { direction: "DEBIT", _sum: { amountCents: 12_345 } },
      { direction: "CREDIT", _sum: { amountCents: 12_344 } },
    ]);
    expect((await getTrialBalance()).balanced).toBe(false);
  });

  it("computes signed balances in each account's natural direction", async () => {
    // A paid $1,000 invoice and an approved-but-unpaid $300 earning.
    ledgerLineGroupBy.mockResolvedValue([
      { account: "ACCOUNTS_RECEIVABLE", direction: "DEBIT", _sum: { amountCents: 100_000 } },
      { account: "ACCOUNTS_RECEIVABLE", direction: "CREDIT", _sum: { amountCents: 100_000 } },
      { account: "CASH", direction: "DEBIT", _sum: { amountCents: 100_000 } },
      { account: "CLIENT_REVENUE", direction: "CREDIT", _sum: { amountCents: 100_000 } },
      { account: "TRAINER_COST", direction: "DEBIT", _sum: { amountCents: 30_000 } },
      { account: "TRAINER_PAYABLE", direction: "CREDIT", _sum: { amountCents: 30_000 } },
    ]);
    const balances = await getAccountBalances();
    const byAccount = Object.fromEntries(balances.map((b) => [b.account, b.balanceCents]));
    expect(byAccount).toEqual({
      CASH: 100_000, // received, not yet paid out
      ACCOUNTS_RECEIVABLE: 0, // invoice was paid
      CLIENT_REVENUE: 100_000,
      TRAINER_PAYABLE: 30_000, // still owed to the trainer
      TRAINER_COST: 30_000,
    });
  });
});
