import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  CheckCircle2,
  AlertTriangle,
  Landmark,
  Wallet,
} from "lucide-react";
import type { LedgerAccount } from "@prisma/client";

import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils/cn";
import {
  getAccountBalances,
  getLedgerSummary,
  getMoneyMovement,
  getTrialBalance,
} from "@/server/services/ledger";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Money movement" };

function usd(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const ACCOUNT_LABELS: Record<LedgerAccount, string> = {
  CASH: "Cash",
  ACCOUNTS_RECEIVABLE: "Receivable from clients",
  CLIENT_REVENUE: "Client revenue",
  TRAINER_PAYABLE: "Owed to trainers",
  TRAINER_COST: "Trainer cost",
};

/** Which journal kinds move money in vs out of the platform, for the
 *  at-a-glance direction column. Everything else is a book entry (owed /
 *  earned) rather than cash actually moving. */
const KIND_META: Record<string, { label: string; flow: "in" | "out" | "book" }> = {
  "invoice.paid": { label: "Client payment", flow: "in" },
  "payout.paid": { label: "Trainer payout", flow: "out" },
  "invoice.sent": { label: "Invoice issued", flow: "book" },
  "invoice.voided": { label: "Invoice voided", flow: "book" },
  "earning.approved": { label: "Earning approved", flow: "book" },
  "earning.reversed": { label: "Earning reversed", flow: "book" },
};

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All activity" },
  { value: "invoice.paid", label: "Money in" },
  { value: "payout.paid", label: "Money out" },
  { value: "invoice.sent", label: "Invoices issued" },
  { value: "earning.approved", label: "Earnings approved" },
  { value: "earning.reversed", label: "Earnings reversed" },
];

export default async function MoneyMovementPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { kind } = await searchParams;
  const activeKind = FILTERS.some((f) => f.value === kind) ? kind : undefined;

  const [summary, balances, trial, transactions] = await Promise.all([
    getLedgerSummary(),
    getAccountBalances(),
    getTrialBalance(),
    getMoneyMovement({ kind: activeKind || undefined, limit: 100 }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Money movement"
        description="Every money event on the platform, from the double-entry ledger. Append-only: corrections post reversals, history never changes."
      />

      {/* Reconciliation proof — the whole point of double entry. If this is
          ever red, a posting was written outside the ledger service. */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border px-4 py-3 text-sm",
          trial.balanced
            ? "border-success/30 bg-success/5 text-success"
            : "border-destructive/40 bg-destructive/5 text-destructive"
        )}
      >
        {trial.balanced ? (
          <CheckCircle2 className="size-4 shrink-0" />
        ) : (
          <AlertTriangle className="size-4 shrink-0" />
        )}
        <span className="font-medium">
          {trial.balanced ? "Books balanced" : "Books out of balance"}
        </span>
        <span className="text-muted-foreground">
          — total debits {usd(trial.debitCents)} / total credits {usd(trial.creditCents)}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Money in (client payments)" value={usd(summary.cashInCents)} icon={ArrowDownToLine} />
        <KpiCard label="Money out (trainer payouts)" value={usd(summary.cashOutCents)} icon={ArrowUpFromLine} />
        <KpiCard label="Owed by clients" value={usd(summary.receivableCents)} icon={Landmark} />
        <KpiCard label="Owed to trainers" value={usd(summary.trainerPayableCents)} icon={Wallet} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account balances</CardTitle>
        </CardHeader>
        <CardContent className="pb-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {balances.map((b) => (
              <div key={b.account} className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">{ACCOUNT_LABELS[b.account]}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{usd(b.balanceCents)}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                  DR {usd(b.debitCents)} · CR {usd(b.creditCents)}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Journal</CardTitle>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={f.value ? `/admin/finance?kind=${f.value}` : "/admin/finance"}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  (activeKind ?? "") === f.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pb-6">
          {transactions.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No ledger activity"
              description="Money events will appear here the moment they happen."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Trace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => {
                  const meta = KIND_META[t.kind] ?? { label: t.kind, flow: "book" as const };
                  const amount = t.lines
                    .filter((l) => l.direction === "DEBIT")
                    .reduce((sum, l) => sum + l.amountCents, 0);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {t.occurredAt.toLocaleDateString()}{" "}
                        {t.occurredAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                            meta.flow === "in" && "bg-success/10 text-success",
                            meta.flow === "out" && "bg-destructive/10 text-destructive",
                            meta.flow === "book" && "bg-muted text-muted-foreground"
                          )}
                        >
                          {meta.flow === "in" ? (
                            <ArrowDownToLine className="size-3" />
                          ) : meta.flow === "out" ? (
                            <ArrowUpFromLine className="size-3" />
                          ) : (
                            <ArrowLeftRight className="size-3" />
                          )}
                          {meta.label}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-sm">{t.counterparty ?? "—"}</TableCell>
                      <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                        {t.description}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          meta.flow === "in" && "text-success",
                          meta.flow === "out" && "text-destructive"
                        )}
                      >
                        {meta.flow === "out" ? "−" : meta.flow === "in" ? "+" : ""}
                        {usd(amount)}
                      </TableCell>
                      <TableCell className="text-[11px] leading-4 text-muted-foreground">
                        {t.lines.map((l) => (
                          <div key={l.id} className="whitespace-nowrap tabular-nums">
                            {l.direction === "DEBIT" ? "DR" : "CR"} {ACCOUNT_LABELS[l.account]}{" "}
                            {usd(l.amountCents)}
                          </div>
                        ))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {t.sourceType} · {t.sourceId.slice(0, 8)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
