import type { Metadata } from "next";

import { brand } from "@/config/brand";
import { MarketingPageHero } from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Sub-processors",
  description:
    "The third-party sub-processors Traivr uses to deliver the platform, what each one processes, and where.",
};

/**
 * The sub-processor register partners' privacy teams ask for during
 * diligence. Rules for this list:
 * - Only vendors that actually touch customer or trainer personal data.
 * - "When enabled" entries are integrations that exist in the product but
 *   only process data once a customer or deployment turns them on —
 *   listed anyway, because appearing here *before* activation is the point.
 * - Update this page in the same change that adds or removes a vendor.
 */
const SUB_PROCESSORS: Array<{
  name: string;
  purpose: string;
  dataProcessed: string;
  location: string;
  conditional?: string;
}> = [
  {
    name: "Vercel Inc.",
    purpose: "Application hosting and content delivery",
    dataProcessed: "All platform traffic, including request logs (IP addresses)",
    location: "United States (global edge network)",
  },
  {
    name: "Neon Inc.",
    purpose: "Managed PostgreSQL database",
    dataProcessed: "All platform data at rest, including account and payment-account records",
    location: "United States",
  },
  {
    name: "Resend Inc.",
    purpose: "Transactional email delivery",
    dataProcessed: "Recipient email addresses and message content (verification, notifications)",
    location: "United States",
  },
  {
    name: "Google LLC",
    purpose: "OAuth sign-in",
    dataProcessed: "Email address and profile name of accounts that choose Google sign-in",
    location: "United States",
    conditional: "Only for accounts using Google sign-in",
  },
  {
    name: "Stripe, Inc.",
    purpose: "Payment processing and payouts",
    dataProcessed: "Payout account identifiers and transaction amounts",
    location: "United States",
    conditional: "When Stripe payouts are enabled",
  },
  {
    name: "Safaricom PLC (M-Pesa)",
    purpose: "Mobile-money payouts",
    dataProcessed: "Payout phone numbers and transaction amounts",
    location: "Kenya",
    conditional: "When M-Pesa payouts are enabled",
  },
  {
    name: "Upstash, Inc.",
    purpose: "Rate-limit counters",
    dataProcessed: "Short-lived request counters keyed by IP address or hashed API key",
    location: "United States",
    conditional: "When shared rate limiting is enabled",
  },
];

export default function SubProcessorsPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Security"
        title="Sub-processors"
        description={`Third parties ${brand.legalName} uses to deliver the platform, what each processes, and where.`}
      />
      <section className="py-16">
        <div className="mx-auto max-w-5xl space-y-8 px-4 sm:px-6 lg:px-8">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Sub-processor</th>
                  <th className="px-4 py-3 font-semibold">Purpose</th>
                  <th className="px-4 py-3 font-semibold">Data processed</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SUB_PROCESSORS.map((sp) => (
                  <tr key={sp.name} className="align-top">
                    <td className="px-4 py-3 font-medium">{sp.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {sp.purpose}
                      {sp.conditional ? (
                        <span className="mt-1 block text-xs text-muted-foreground/70">
                          {sp.conditional}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{sp.dataProcessed}</td>
                    <td className="px-4 py-3 text-muted-foreground">{sp.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Each sub-processor is bound by a data processing agreement with terms no less
              protective than our own commitments to customers. We review this list before adding
              any vendor that would process customer or trainer personal data.
            </p>
            <p>
              <strong className="font-semibold text-foreground">Change notice:</strong> customers
              with a data processing agreement in place are notified by email at least 30 days
              before a new sub-processor begins processing their data, with the opportunity to
              object.
            </p>
            <p>
              Questions about this register or our data practices:{" "}
              <a
                href={`mailto:${brand.supportEmail}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {brand.supportEmail}
              </a>
              .
            </p>
            <p className="text-xs">Last updated: August 26, 2026.</p>
          </div>
        </div>
      </section>
    </>
  );
}
