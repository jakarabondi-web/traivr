import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Receipt, CornerDownRight } from "lucide-react";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/permissions/can";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge-status";
import { InvoiceActions } from "@/components/admin/invoice-actions";
import { Fragment } from "react";

export const metadata: Metadata = { title: "Invoices" };
const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function InvoicesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const canManage = can(session.user.roles, "payment.approve");

  const [invoices, totals] = await Promise.all([
    prisma.invoice.findMany({
      include: {
        organization: true,
        lineItems: { include: { project: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.groupBy({ by: ["status"], _sum: { amountCents: true } }),
  ]);
  const sumFor = (s: string) => totals.find((t) => t.status === s)?._sum.amountCents ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Client invoices" description="Billing issued to client organizations, itemized line by line." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Paid" value={usd(sumFor("PAID"))} icon={Receipt} />
        <KpiCard label="Sent" value={usd(sumFor("SENT"))} />
        <KpiCard label="Overdue" value={usd(sumFor("OVERDUE"))} trend={sumFor("OVERDUE") > 0 ? "down" : "flat"} />
        <KpiCard label="Draft" value={usd(sumFor("DRAFT"))} />
      </div>
      <Card>
        <CardContent className="pt-6 pb-6">
          {invoices.length === 0 ? (
            <EmptyState icon={Receipt} title="No invoices yet" description="Client invoices will appear here once billing runs." />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Invoice</TableHead><TableHead>Client</TableHead><TableHead>Amount</TableHead>
                <TableHead>Due</TableHead><TableHead>Status</TableHead>
                {canManage ? <TableHead></TableHead> : null}
              </TableRow></TableHeader>
              <TableBody>
                {invoices.map((i) => (
                  <Fragment key={i.id}>
                    <TableRow>
                      <TableCell className="font-mono text-xs">{i.number ?? i.id.slice(0, 8)}</TableCell>
                      <TableCell>{i.organization.name}</TableCell>
                      <TableCell className="tabular-nums font-medium">{usd(i.amountCents)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.dueDate?.toLocaleDateString() ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={i.status} /></TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <InvoiceActions invoiceId={i.id} status={i.status} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                    {/* Line items: what this invoice actually bills for, and
                        which project the work traces back to. */}
                    {i.lineItems.length > 0 ? (
                      <TableRow className="border-0 hover:bg-transparent">
                        <TableCell colSpan={canManage ? 6 : 5} className="py-0 pb-3 pt-0">
                          <div className="ml-1 space-y-0.5">
                            {i.lineItems.map((li) => (
                              <div key={li.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <CornerDownRight className="size-3 shrink-0" />
                                <span className="truncate">
                                  {li.description}
                                  {li.project ? (
                                    <span className="text-muted-foreground/70"> · {li.project.name}</span>
                                  ) : null}
                                </span>
                                <span className="ml-auto whitespace-nowrap tabular-nums">
                                  {li.quantity > 1 ? `${li.quantity} × ${usd(li.unitCents)} = ` : ""}
                                  {usd(li.amountCents)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
