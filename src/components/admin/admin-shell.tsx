"use client";

import {
  LayoutDashboard,
  TrendingUp,
  Users,
  UserPlus,
  Building2,
  Briefcase,
  ListChecks,
  ClipboardCheck,
  BarChart3,
  GraduationCap,
  Wallet,
  Receipt,
  ArrowLeftRight,
  Scale,
  LifeBuoy,
  ShieldAlert,
  FileClock,
  ShieldCheck,
  UserCog,
  Settings,
} from "lucide-react";

import { DashboardShell, type NavSection } from "@/components/navigation/dashboard-shell";

function buildNavSections(counts: {
  pendingApplications: number;
  payoutQueue: number;
  pendingProjectApplications: number;
}): NavSection[] {
  return [
    {
      label: "Overview",
      items: [
        { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/admin/analytics", label: "Analytics", icon: TrendingUp },
      ],
    },
    {
      label: "People",
      items: [
        { href: "/admin/trainers", label: "Trainers", icon: Users },
        {
          href: "/admin/applications",
          label: "Applications",
          icon: UserPlus,
          badge: counts.pendingApplications || undefined,
        },
        { href: "/admin/clients", label: "Clients", icon: Building2 },
      ],
    },
    {
      label: "Work",
      items: [
        {
          href: "/admin/projects",
          label: "Projects",
          icon: Briefcase,
          badge: counts.pendingProjectApplications || undefined,
          badgeVariant: "attention",
        },
        { href: "/admin/tasks", label: "Tasks", icon: ListChecks },
        { href: "/admin/reviews", label: "Reviews", icon: ClipboardCheck },
      ],
    },
    {
      label: "Quality",
      items: [
        { href: "/admin/quality", label: "Quality dashboard", icon: BarChart3 },
        { href: "/admin/assessments", label: "Assessments", icon: GraduationCap },
      ],
    },
    {
      label: "Finance",
      items: [
        { href: "/admin/finance", label: "Money movement", icon: ArrowLeftRight },
        { href: "/admin/payments", label: "Payouts", icon: Wallet, badge: counts.payoutQueue || undefined },
        { href: "/admin/invoices", label: "Invoices", icon: Receipt },
        { href: "/admin/disputes", label: "Disputes", icon: Scale },
      ],
    },
    {
      label: "Trust & safety",
      items: [
        { href: "/admin/support", label: "Support", icon: LifeBuoy },
        { href: "/admin/fraud", label: "Fraud alerts", icon: ShieldAlert },
        { href: "/admin/compliance", label: "Compliance", icon: ShieldCheck },
        { href: "/admin/audit-logs", label: "Audit logs", icon: FileClock },
      ],
    },
    {
      label: "Administration",
      items: [
        { href: "/admin/users", label: "Users & roles", icon: UserCog },
        { href: "/admin/settings", label: "Settings", icon: Settings },
      ],
    },
  ];
}

export function AdminShell({
  userName,
  userEmail,
  roleLabel,
  pendingApplications = 0,
  payoutQueue = 0,
  pendingProjectApplications = 0,
  children,
}: {
  userName: string;
  userEmail: string;
  roleLabel: string;
  pendingApplications?: number;
  payoutQueue?: number;
  pendingProjectApplications?: number;
  children: React.ReactNode;
}) {
  return (
    <DashboardShell
      navSections={buildNavSections({ pendingApplications, payoutQueue, pendingProjectApplications })}
      surfaceLabel="Admin console"
      userName={userName}
      userEmail={userEmail}
      userRoleLabel={roleLabel}
      notificationsHref="/admin/dashboard"
    >
      {children}
    </DashboardShell>
  );
}
