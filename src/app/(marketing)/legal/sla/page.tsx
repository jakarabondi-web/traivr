import type { Metadata } from "next";

import { brand } from "@/config/brand";
import { MarketingPageHero } from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Service level agreement",
  description:
    "Traivr's service level commitments: uptime target, support response times by severity, maintenance windows, and incident communication.",
};

const SEVERITIES: Array<{
  level: string;
  definition: string;
  firstResponse: string;
  updates: string;
}> = [
  {
    level: "Sev 1 — Critical",
    definition: "Platform unavailable, data integrity at risk, or a security incident",
    firstResponse: "1 hour, 24×7",
    updates: "Every 2 hours until resolved",
  },
  {
    level: "Sev 2 — Major",
    definition: "A core workflow (task delivery, review, exports, payouts) broken with no workaround",
    firstResponse: "4 business hours",
    updates: "Daily",
  },
  {
    level: "Sev 3 — Minor",
    definition: "Degraded or inconvenient behavior with a workaround",
    firstResponse: "1 business day",
    updates: "On change",
  },
  {
    level: "Sev 4 — Question",
    definition: "How-to questions and feature requests",
    firstResponse: "2 business days",
    updates: "On change",
  },
];

export default function SlaPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Legal"
        title="Service level agreement"
        description="The service commitments we make to customers on paid plans."
      />
      <section className="py-16">
        <div className="mx-auto max-w-3xl space-y-10 px-4 text-sm sm:px-6 lg:px-8">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Availability</h2>
            <p className="text-muted-foreground">
              {brand.legalName} targets <strong className="text-foreground">99.9% monthly uptime</strong>{" "}
              for the platform and client API, excluding scheduled maintenance. Current and
              historical status is published at{" "}
              <a href="/status" className="text-primary underline-offset-4 hover:underline">
                /status
              </a>
              .
            </p>
            <p className="text-muted-foreground">
              Service credits for missed availability targets are defined in each customer&apos;s
              master service agreement.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Support response times</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left">
                <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Severity</th>
                    <th className="px-4 py-3 font-semibold">Definition</th>
                    <th className="px-4 py-3 font-semibold">First response</th>
                    <th className="px-4 py-3 font-semibold">Updates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {SEVERITIES.map((s) => (
                    <tr key={s.level} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 font-medium">{s.level}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.definition}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{s.firstResponse}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{s.updates}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground">
              Business hours are 09:00–18:00 East Africa Time, Monday to Friday. Issues are
              reported to{" "}
              <a
                href={`mailto:${brand.supportEmail}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {brand.supportEmail}
              </a>{" "}
              or through the in-product support desk; severity is assigned on first response and
              confirmed with the reporter.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Scheduled maintenance</h2>
            <p className="text-muted-foreground">
              Maintenance that risks interruption is scheduled outside peak hours and announced at
              least 72 hours in advance by email and on the status page. Most deployments are
              zero-downtime and are not announced.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Incident communication</h2>
            <p className="text-muted-foreground">
              Sev 1 and Sev 2 incidents are acknowledged on the status page while in progress.
              After any Sev 1 incident, affected customers receive a written post-incident review
              within 5 business days covering the timeline, root cause, customer impact, and the
              corrective actions we are taking. Security incidents involving customer data follow
              the notification timelines in the customer&apos;s data processing agreement.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Precedence</h2>
            <p className="text-muted-foreground">
              This page describes {brand.legalName}&apos;s standard commitments. Where a signed
              master service agreement or order form defines different terms, the signed agreement
              governs.
            </p>
            <p className="text-xs text-muted-foreground">Last updated: August 26, 2026.</p>
          </div>
        </div>
      </section>
    </>
  );
}
