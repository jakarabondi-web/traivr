import { describe, expect, it, vi, beforeEach } from "vitest";

// Interactive-transaction fake: runs the callback against a tx client whose
// calls we can inspect, which is exactly how the service uses prisma.
const invoiceFindUnique = vi.fn();
const txInvoiceUpdate = vi.fn();
const txInvoiceFindFirst = vi.fn();
const txAuditLogCreate = vi.fn();
const txLedgerFindUnique = vi.fn();
const txLedgerCreate = vi.fn();

const tx = {
  invoice: {
    update: (...a: unknown[]) => txInvoiceUpdate(...a),
    findFirst: (...a: unknown[]) => txInvoiceFindFirst(...a),
  },
  auditLog: { create: (...a: unknown[]) => txAuditLogCreate(...a) },
  ledgerTransaction: {
    findUnique: (...a: unknown[]) => txLedgerFindUnique(...a),
    create: (...a: unknown[]) => txLedgerCreate(...a),
  },
};

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    invoice: { findUnique: (...a: unknown[]) => invoiceFindUnique(...a) },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));

const { markInvoiceSent, markInvoicePaid, voidInvoice, InvoiceError } = await import(
  "@/server/services/invoices"
);

const baseInvoice = {
  id: "inv-1",
  organizationId: "org-1",
  number: null,
  amountCents: 100_000,
  status: "DRAFT",
  dueDate: null,
  paidAt: null,
  createdAt: new Date(),
};

beforeEach(() => {
  invoiceFindUnique.mockReset();
  txInvoiceUpdate.mockReset().mockResolvedValue({});
  txInvoiceFindFirst.mockReset().mockResolvedValue(null);
  txAuditLogCreate.mockReset().mockResolvedValue({});
  txLedgerFindUnique.mockReset().mockResolvedValue(null);
  txLedgerCreate.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: "t", ...data }));
});

function postedKinds() {
  return txLedgerCreate.mock.calls.map((c) => c[0].data.kind);
}

describe("invoice transitions post to the ledger", () => {
  it("sending posts invoice.sent and assigns the first invoice number", async () => {
    invoiceFindUnique.mockResolvedValue({ ...baseInvoice });
    await markInvoiceSent({ invoiceId: "inv-1", actorId: "admin-1" });

    expect(postedKinds()).toEqual(["invoice.sent"]);
    // Two updates: the status transition, then the number assignment.
    const numberUpdate = txInvoiceUpdate.mock.calls.find((c) => c[0].data.number);
    expect(numberUpdate?.[0].data.number).toBe("INV-0001");
  });

  it("numbering continues after the highest existing number", async () => {
    invoiceFindUnique.mockResolvedValue({ ...baseInvoice });
    txInvoiceFindFirst.mockResolvedValue({ number: "INV-0041" });
    await markInvoiceSent({ invoiceId: "inv-1", actorId: "admin-1" });
    const numberUpdate = txInvoiceUpdate.mock.calls.find((c) => c[0].data.number);
    expect(numberUpdate?.[0].data.number).toBe("INV-0042");
  });

  it("marking paid posts invoice.paid", async () => {
    invoiceFindUnique.mockResolvedValue({ ...baseInvoice, status: "SENT", number: "INV-0001" });
    await markInvoicePaid({ invoiceId: "inv-1", actorId: "admin-1" });
    expect(postedKinds()).toEqual(["invoice.paid"]);
  });

  it("voiding a sent invoice posts the reversal", async () => {
    invoiceFindUnique.mockResolvedValue({ ...baseInvoice, status: "SENT", number: "INV-0001" });
    await voidInvoice({ invoiceId: "inv-1", actorId: "admin-1" });
    expect(postedKinds()).toEqual(["invoice.voided"]);
  });

  it("voiding a draft posts nothing — a draft never reached the ledger", async () => {
    invoiceFindUnique.mockResolvedValue({ ...baseInvoice, status: "DRAFT" });
    await voidInvoice({ invoiceId: "inv-1", actorId: "admin-1" });
    expect(txLedgerCreate).not.toHaveBeenCalled();
  });

  it("still refuses illegal transitions", async () => {
    invoiceFindUnique.mockResolvedValue({ ...baseInvoice, status: "PAID" });
    await expect(voidInvoice({ invoiceId: "inv-1", actorId: "admin-1" })).rejects.toThrow(
      InvoiceError
    );
    expect(txLedgerCreate).not.toHaveBeenCalled();
  });
});
