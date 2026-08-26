import type { Metadata } from "next";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

import { brand } from "@/config/brand";
import { prisma } from "@/lib/db/prisma";
import { isEmailConfigured } from "@/lib/email/client";
import { cn } from "@/lib/utils/cn";
import { MarketingPageHero } from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Status",
  description: "Live operational status of the Traivr platform: application, API, and database health.",
};

// Live checks on every request — a status page served from a cache is a
// status page that lies during the one incident it exists for.
export const dynamic = "force-dynamic";

type ComponentStatus = "operational" | "degraded" | "down";

async function checkDatabase(): Promise<ComponentStatus> {
  try {
    const started = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    // A database that answers but takes seconds is an incident in progress.
    return Date.now() - started < 2000 ? "operational" : "degraded";
  } catch {
    return "down";
  }
}

const STATUS_META: Record<ComponentStatus, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  operational: { label: "Operational", icon: CheckCircle2, tone: "text-success" },
  degraded: { label: "Degraded", icon: AlertTriangle, tone: "text-accent-amber" },
  down: { label: "Outage", icon: XCircle, tone: "text-destructive" },
};

export default async function StatusPage() {
  const database = await checkDatabase();

  // If this page rendered at all, the application and API runtime are
  // serving requests. The API's data path shares the database's health —
  // it cannot be better than the database it reads from.
  const components: Array<{ name: string; detail: string; status: ComponentStatus }> = [
    {
      name: "Web application",
      detail: "Dashboards, task workspaces, and marketing site",
      status: "operational",
    },
    {
      name: "Client API (v1)",
      detail: "Programmatic project, task, and export access",
      status: database === "down" ? "down" : database,
    },
    { name: "Database", detail: "Primary data store", status: database },
    {
      name: "Email delivery",
      detail: "Verification, notification, and reset emails",
      status: isEmailConfigured() ? "operational" : "degraded",
    },
  ];

  const worst: ComponentStatus = components.some((c) => c.status === "down")
    ? "down"
    : components.some((c) => c.status === "degraded")
      ? "degraded"
      : "operational";
  const WorstIcon = STATUS_META[worst].icon;

  return (
    <>
      <MarketingPageHero
        eyebrow="Status"
        title="Platform status"
        description="Checked live on every visit — nothing here is cached."
      />
      <section className="py-16">
        <div className="mx-auto max-w-3xl space-y-6 px-4 sm:px-6 lg:px-8">
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg border px-5 py-4",
              worst === "operational" && "border-success/30 bg-success/5",
              worst === "degraded" && "border-accent-amber/30 bg-accent-amber/5",
              worst === "down" && "border-destructive/30 bg-destructive/5"
            )}
          >
            <WorstIcon className={cn("size-5", STATUS_META[worst].tone)} />
            <p className="font-semibold">
              {worst === "operational"
                ? "All systems operational"
                : worst === "degraded"
                  ? "Some systems degraded"
                  : "Service disruption in progress"}
            </p>
            <p className="ml-auto text-xs text-muted-foreground">
              as of {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC
            </p>
          </div>

          <div className="divide-y divide-border rounded-lg border border-border">
            {components.map((c) => {
              const meta = STATUS_META[c.status];
              const Icon = meta.icon;
              return (
                <div key={c.name} className="flex items-center gap-3 px-5 py-4">
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.detail}</p>
                  </div>
                  <span className={cn("ml-auto flex items-center gap-1.5 text-sm font-medium", meta.tone)}>
                    <Icon className="size-4" />
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              During an incident, updates are posted here and affected customers are notified by
              email. Our incident response process — severity levels, response targets, and
              post-incident review — is described in the{" "}
              <a href="/legal/sla" className="text-primary underline-offset-4 hover:underline">
                service level agreement
              </a>
              .
            </p>
            <p>
              To report an issue, email{" "}
              <a
                href={`mailto:${brand.supportEmail}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {brand.supportEmail}
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
