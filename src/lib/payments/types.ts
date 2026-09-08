export type PayoutProviderKey = "STRIPE_CONNECT" | "MPESA";

export type PayoutRequestInput = {
  payoutRequestId: string;
  amountCents: number;
  currency: string;
  /** Provider-native minor/whole-unit amount when it differs from ledger cents. */
  providerAmount?: number;
  /** Stripe connected-account id, or the M-Pesa MSISDN, depending on provider. */
  destination: string;
  reference: string;
};

export type PayoutResult =
  | { ok: true; providerReference: string; mocked: boolean }
  | { ok: "pending"; providerReference: string; mocked: false }
  | { ok: false; failureReason: string; mocked: boolean };

export interface PayoutProvider {
  readonly key: PayoutProviderKey;
  readonly label: string;
  /** True when the provider has no real credentials configured and is simulating. */
  isMocked(): boolean;
  send(input: PayoutRequestInput): Promise<PayoutResult>;
}
