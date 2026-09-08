import { describe, expect, it, vi, beforeEach } from "vitest";

// field-encryption's key derives from AUTH_SECRET. Normally the real
// @prisma/client import loads .env as a side effect and this is already
// set — but this file mocks @/lib/db/prisma, so that side effect never
// runs. Set it explicitly rather than depend on an unrelated module's
// incidental behavior.
process.env.AUTH_SECRET ??= "test-only-secret-do-not-use-in-real-deployment";

const payoutRequestFindUnique = vi.fn();
const payoutRequestUpdate = vi.fn();
const earningUpdateMany = vi.fn();
const notificationCreate = vi.fn();
const auditLogCreate = vi.fn();
const transaction = vi.fn();
const send = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    payoutRequest: {
      findUnique: (...a: unknown[]) => payoutRequestFindUnique(...a),
      update: (...a: unknown[]) => payoutRequestUpdate(...a),
    },
    earning: { updateMany: (...a: unknown[]) => earningUpdateMany(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

vi.mock("@/lib/payments", () => ({
  getPayoutProvider: () => ({ label: "M-Pesa", send: (...a: unknown[]) => send(...a) }),
}));

const { processPayoutRequest } = await import("@/server/services/payouts");
const { encryptField } = await import("@/lib/security/field-encryption");

beforeEach(() => {
  process.env.MPESA_USD_TO_KES_RATE = "1";
  payoutRequestUpdate.mockReset().mockResolvedValue({});
  earningUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  notificationCreate.mockReset().mockResolvedValue({});
  auditLogCreate.mockReset().mockResolvedValue({});
  transaction.mockReset().mockResolvedValue([]);
  send.mockReset().mockResolvedValue({ ok: true, mocked: true, providerReference: "mock_ref" });
});

describe("processPayoutRequest — M-Pesa destination decryption", () => {
  it("decrypts the stored mpesaPhoneNumber before sending to the provider", async () => {
    const realNumber = "254712345678";
    payoutRequestFindUnique.mockResolvedValue({
      id: "req-1",
      status: "REQUESTED",
      provider: "MPESA",
      amountCents: 5000,
      userId: "user-1",
      paymentAccount: { mpesaPhoneNumber: encryptField(realNumber), externalId: null },
    });

    await processPayoutRequest({ payoutRequestId: "req-1", actorId: "admin-1" });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ destination: realNumber }));
  });

  it("never sends the raw ciphertext as the payout destination", async () => {
    const realNumber = "254799887766";
    const ciphertext = encryptField(realNumber);
    payoutRequestFindUnique.mockResolvedValue({
      id: "req-2",
      status: "APPROVED",
      provider: "MPESA",
      amountCents: 2500,
      userId: "user-2",
      paymentAccount: { mpesaPhoneNumber: ciphertext, externalId: null },
    });

    await processPayoutRequest({ payoutRequestId: "req-2", actorId: "admin-1" });

    const call = send.mock.calls[0]?.[0] as { destination: string };
    expect(call.destination).not.toBe(ciphertext);
    expect(call.destination).toBe(realNumber);
  });

  it("still sends a legacy plaintext number correctly, rather than throwing", async () => {
    // A PaymentAccount created before mpesaPhoneNumber started encrypting.
    // This is a real M-Pesa payout — throwing here means real money never
    // moves for anyone who added their account before this change shipped.
    const legacyNumber = "254711223344";
    payoutRequestFindUnique.mockResolvedValue({
      id: "req-3",
      status: "REQUESTED",
      provider: "MPESA",
      amountCents: 1000,
      userId: "user-3",
      paymentAccount: { mpesaPhoneNumber: legacyNumber, externalId: null },
    });

    await processPayoutRequest({ payoutRequestId: "req-3", actorId: "admin-1" });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ destination: legacyNumber }));
  });
});
