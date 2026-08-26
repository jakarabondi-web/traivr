import type { Metadata } from "next";
import Link from "next/link";
import { Lock, KeyRound, FileClock, Building2, ShieldCheck, ServerCog, EyeOff, ClipboardCheck } from "lucide-react";

import { MarketingPageHero } from "@/components/marketing/page-hero";
import { FeatureBento, type FeatureBentoItem } from "@/components/marketing/feature-bento";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Traivr secures AI training data: role-based access, field-level encryption, audit logging, tenant isolation, and SOC 2-aligned controls.",
};

const CONTROLS: FeatureBentoItem[] = [
  {
    icon: <Lock className="size-6" />,
    title: "Role-based access control",
    desc: "Every permission enforced server-side, not just in the UI.",
    tag: "RBAC",
  },
  {
    icon: <KeyRound className="size-6" />,
    title: "Encryption in transit and at rest",
    desc: "Standard TLS in transit. At rest, specific high-risk fields — 2FA secrets, payout details, login history — are additionally encrypted at the application level, not just relying on disk encryption.",
    tag: "Encryption",
  },
  {
    icon: <FileClock className="size-6" />,
    title: "Audit logging",
    desc: "Approvals, payments, exports — logged with actor and timestamp.",
    tag: "Audit trail",
  },
  {
    icon: <Building2 className="size-6" />,
    title: "Project & tenant isolation",
    desc: "Each org's data and workforce isolated from every other.",
    tag: "Isolation",
  },
  {
    icon: <ShieldCheck className="size-6" />,
    title: "Secure task workspaces",
    desc: "Scoped to assigned, qualified workers only.",
    tag: "Workspace scoping",
  },
  {
    icon: <ServerCog className="size-6" />,
    title: "Data-retention controls",
    desc: "Defined retention windows for login and location history, enforced by an automated daily sweep — not indefinite by default.",
    tag: "Retention",
  },
  {
    icon: <EyeOff className="size-6" />,
    title: "Reviewer identity separation",
    desc: "Trainer identity withheld from reviewers by default.",
    tag: "Identity separation",
  },
  {
    icon: <ClipboardCheck className="size-6" />,
    title: "Designed for SOC 2 readiness",
    desc: "Built around SOC 2 Trust Services Criteria. Not yet certified.",
    tag: "SOC 2-aligned",
  },
];

export default function SecurityPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Security"
        title="Security is a first-class product requirement"
        description="Enterprise AI teams trust Traivr with sensitive prompts, model outputs, and evaluation data. Here's how we protect it."
      />
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <FeatureBento items={CONTROLS} />
        </div>
      </section>
      <section className="border-t border-border bg-surface py-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <h2 className="text-lg font-semibold">For your diligence team</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The documents privacy and procurement reviews ask for, published rather than gated.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm font-medium">
            <Link
              href="/security/sub-processors"
              className="rounded-md border border-border px-4 py-2 transition-colors hover:bg-accent"
            >
              Sub-processor register
            </Link>
            <Link
              href="/legal/sla"
              className="rounded-md border border-border px-4 py-2 transition-colors hover:bg-accent"
            >
              Service level agreement
            </Link>
            <Link
              href="/status"
              className="rounded-md border border-border px-4 py-2 transition-colors hover:bg-accent"
            >
              Live status
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
