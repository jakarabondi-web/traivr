import Link from "next/link";
import { Fragment } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  ShieldCheck,
  ScanSearch,
  ListOrdered,
  Languages,
  Code2,
  FlaskConical,
  Scale,
  Stethoscope,
  Calculator,
  BookOpenText,
  Landmark,
  Lock,
  KeyRound,
  FileClock,
  Building2,
  BadgeCheck,
  Wallet,
  MessageSquareQuote,
  Globe2,
  Target,
  UserCheck,
  PackageCheck,
  Cpu,
  Terminal,
  Workflow,
  Binary,
  Database,
  Fingerprint,
  Radar,
  Layers,
  ClipboardCheck,
  Sparkles,
} from "lucide-react";

import { brand } from "@/config/brand";
import { auth } from "@/lib/auth";
import { dashboardPathForSurface } from "@/lib/permissions/roles";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InteractiveHero } from "@/components/marketing/interactive-hero";
import { NeuralMesh } from "@/components/shared/neural-mesh";
import { WorldNetworkMap } from "@/components/shared/world-network-map";
import { RegistrationSteps } from "@/components/marketing/registration-steps";
import { FeatureBento, type FeatureBentoItem } from "@/components/marketing/feature-bento";
import { ServiceOrbit, type ServiceOrbitItem } from "@/components/marketing/service-orbit";
import { ICON_BADGE_COLORS } from "@/lib/constants/icon-colors";

/** Small icon+label chip — a lighter cousin of FeatureBento's badge that
 *  draws from the same ICON_BADGE_COLORS palette, for places (expert
 *  category chips, the client-steps flow) that need just a badge, not a
 *  full expandable card. */
function IconChip({
  icon,
  index,
  className,
}: {
  icon: React.ReactNode;
  index: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-xl",
        ICON_BADGE_COLORS[index % ICON_BADGE_COLORS.length],
        className
      )}
    >
      {icon}
    </span>
  );
}

export const metadata: Metadata = {
  // `absolute` opts out of the root layout's "%s · Traivr" template, which
  // would otherwise append the brand name to a title that already opens with
  // it.
  title: { absolute: `${brand.name} — Train better AI with verified human expertise` },
};

const SERVICES: ServiceOrbitItem[] = [
  {
    icon: <Cpu className="size-6" />,
    title: "RLHF & preference data",
    label: "RLHF",
    desc: "Vetted trainers rank competing model responses head-to-head using Bradley–Terry pairwise comparisons, with disagreements adjudicated before anything ships. Output lands as a reward-model-ready dataset your training pipeline can ingest directly, no reformatting on your end.",
    tag: "Reward modeling",
    chips: ["Pairwise ranking", "Reward-model export", "Inter-rater agreement"],
  },
  {
    icon: <Terminal className="size-6" />,
    title: "Supervised fine-tuning",
    label: "Fine-tuning",
    desc: "Subject-matter experts write ideal responses and prompts by hand, not templated filler, and every example carries a full revision history so you can audit exactly who wrote what and when it changed.",
    tag: "SFT",
    chips: ["Ideal responses", "Prompt authoring", "Revision history"],
  },
  {
    icon: <Workflow className="size-6" />,
    title: "Model evaluations",
    label: "Evaluations",
    desc: "We score your model against the rubric you define, inside your own evaluation harness, and return a per-category breakdown instead of one opaque number, so you can see exactly where quality is slipping.",
    tag: "Eval harness",
    chips: ["Rubric scoring", "Per-category report", "Harness-native"],
  },
  {
    icon: <Binary className="size-6" />,
    title: "Red teaming",
    label: "Red teaming",
    desc: "Adversarial probes mapped to the OWASP LLM Top 10 — prompt injection, jailbreaks, data exfiltration, all logged and scored by qualified red-teamers, not a static scanner.",
    tag: "OWASP LLM Top 10",
    chips: ["Prompt injection", "Jailbreak probes", "Human-scored"],
  },
  {
    icon: <Database className="size-6" />,
    title: "Expert data creation",
    label: "Data creation",
    desc: "Original datasets built to your spec by domain experts, cleared for license end to end, and versioned from the first draft — so provenance is never a question you have to chase down later.",
    tag: "Dataset authoring",
    chips: ["License-cleared", "Domain experts", "Versioned sets"],
  },
  {
    icon: <Globe2 className="size-6" />,
    title: "Multilingual evaluation",
    label: "Multilingual",
    desc: "Native-fluency reviewers across 30+ languages catch what machine translation checks miss — idiom, tone, and cultural nuance — so your model reads naturally to a real speaker, not just correctly to a parser.",
    tag: "i18n / L10n",
    chips: ["Native fluency", "30+ languages", "Cultural nuance"],
  },
  {
    icon: <Code2 className="size-6" />,
    title: "Code & reasoning tasks",
    label: "Code & reasoning",
    desc: "Working engineers review generated code and multi-step reasoning chains line by line, exporting a clean pass/fail signal per step so you can trace exactly where a chain of reasoning broke down.",
    tag: "SWE-bench style",
    chips: ["Line-by-line review", "Pass/fail export", "Chain tracing"],
  },
  {
    icon: <Fingerprint className="size-6" />,
    title: "Safety & policy testing",
    label: "Safety testing",
    desc: "Trained classifiers flag policy violations and hallucinations against your own guidelines, not a generic off-the-shelf policy, with every flag reviewed by a human before it counts.",
    tag: "Trust & safety",
    chips: ["Policy classification", "Hallucination detection", "Human-reviewed"],
  },
];

const EXPERT_CATEGORIES = [
  { icon: <Code2 className="size-6" />, label: "Software engineers" },
  { icon: <Calculator className="size-6" />, label: "Mathematicians" },
  { icon: <FlaskConical className="size-6" />, label: "Scientists" },
  { icon: <Scale className="size-6" />, label: "Legal experts" },
  { icon: <Stethoscope className="size-6" />, label: "Medical experts" },
  { icon: <Landmark className="size-6" />, label: "Finance professionals" },
  { icon: <Languages className="size-6" />, label: "Linguists" },
  { icon: <BookOpenText className="size-6" />, label: "Researchers" },
  { icon: <Sparkles className="size-6" />, label: "General assistants" },
];

const CLIENT_STEPS = [
  { title: "Define the project", desc: "Set your task type, rubric, domain, and quality bar in the project wizard.", icon: <Target className="size-6" /> },
  { title: "Match with verified experts", desc: "Our matching engine pairs your project with qualified, available specialists.", icon: <UserCheck className="size-6" /> },
  { title: "Collect and review data", desc: "Multi-stage review, consensus scoring, and adjudication keep quality high.", icon: <ScanSearch className="size-6" /> },
  { title: "Export production-ready results", desc: "Download or stream client-ready datasets through the API.", icon: <PackageCheck className="size-6" /> },
];

const QUALITY_POINTS: FeatureBentoItem[] = [
  { icon: <BadgeCheck className="size-6" />, title: "Qualification testing", desc: "Domain assessments gate access to live tasks.", tag: "Access control" },
  { icon: <Radar className="size-6" />, title: "Gold-standard tasks", desc: "Hidden benchmarks calibrate accuracy continuously.", tag: "Calibration" },
  { icon: <Layers className="size-6" />, title: "Multi-stage review", desc: "Reviewer and lead-reviewer sign-off before ship.", tag: "Review pipeline" },
  { icon: <ListOrdered className="size-6" />, title: "Consensus scoring", desc: "Duplicate assignments surface disagreement automatically.", tag: "Consensus" },
  { icon: <ScanSearch className="size-6" />, title: "Anomaly detection", desc: "Automated signals flag outlier patterns for follow-up.", tag: "Anomaly detection" },
  { icon: <Scale className="size-6" />, title: "Human adjudication", desc: "Lead reviewers resolve edge cases — never fully automated.", tag: "Adjudication" },
];

const SECURITY_POINTS: FeatureBentoItem[] = [
  { icon: <Lock className="size-6" />, title: "Role-based access", desc: "Server-enforced permissions, every surface.", tag: "RBAC" },
  { icon: <KeyRound className="size-6" />, title: "Encryption", desc: "In transit and at rest, sensitive fields encrypted.", tag: "Encryption" },
  { icon: <FileClock className="size-6" />, title: "Audit logging", desc: "Actor, target, timestamp — every sensitive action.", tag: "Audit trail" },
  { icon: <Building2 className="size-6" />, title: "Project isolation", desc: "Tenant data isolated per organization by default.", tag: "Isolation" },
  { icon: <ShieldCheck className="size-6" />, title: "Secure workspaces", desc: "Task content scoped to assigned, qualified workers.", tag: "Workspace scoping" },
  { icon: <ClipboardCheck className="size-6" />, title: "Designed for SOC 2 readiness", desc: "Built around SOC 2-aligned controls as we pursue certification.", tag: "SOC 2-aligned" },
];

const TRAINER_BENEFITS = [
  "Flexible projects you choose, on your schedule",
  "Transparent pay shown before you start any task",
  "Work matched to your background — specialist field or general skills",
  "Quality bonuses for consistently strong submissions",
  "Clear, actionable feedback from senior reviewers",
  "Reliable, on-time payments with full history",
];


export default async function HomePage() {
  // OAuth and SSO sign-ins land here (they redirect to "/"), and this
  // marketing page has no way to show a signed-in state — so a successful
  // sign-in would otherwise look identical to never having signed in at
  // all. Send anyone with a session straight to their dashboard instead —
  // but only when they actually have a role to send them to. A session
  // with no recognized role redirecting into a surface it can't access
  // would bounce straight to /403 with no way back; showing the ordinary
  // marketing page is the safe fallback for that edge case.
  const session = await auth();
  if (session?.user?.surface) {
    redirect(dashboardPathForSurface(session.user.surface));
  }

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-surface via-background to-background">
        {/* Live neural mesh — the network of experts feeding a model, made
            literal. Light tone: same blue hue range as the dark version
            elsewhere, pulled darker so it holds up against this background.
            Denser and much longer linkDistance than other NeuralMesh
            instances so the web reads as fully interconnected throughout,
            not a scatter of occasional lines. */}
        <NeuralMesh density={0.00024} maxNodes={130} linkDistance={210} tone="light" opacity={0.85} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_0%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent_60%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-28">
          <div>
            <Badge
              variant="outline"
              className="border-primary/25 bg-primary/5 font-mono text-[11px] uppercase tracking-widest text-primary"
            >
              Human expertise for better AI
            </Badge>
            <h1 className="mt-5 text-4xl font-medium tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Train better AI with{" "}
              <span className="font-extrabold text-foreground">verified human expertise</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              {brand.name} connects leading AI teams with carefully vetted specialists who create, evaluate, and
              improve high-quality training data.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" variant="violet" asChild>
                <Link href="/contact">
                  Book a demo <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/apply">Become an AI trainer</Link>
              </Button>
            </div>
          </div>

          {/* Illustrative practice task; no customer activity or assessment results. */}
          <div className="mx-auto w-full max-w-md">
            <InteractiveHero />
          </div>
        </div>
      </section>

      {/* What Traivr does — the full pipeline, numbered like the stages it is */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <span className="font-mono text-xs uppercase tracking-widest text-primary">01 · What we do</span>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Every capability, one living network
            </h2>
            <p className="mt-3 text-muted-foreground">
              From raw prompt generation to production-ready datasets, run the full lifecycle of human-in-the-loop AI
              training on one platform.
            </p>
          </div>
          <div className="mt-10">
            <ServiceOrbit items={SERVICES} />
          </div>
        </div>
      </section>

      {/* How it works for AI companies */}
      <section className="border-y border-border bg-surface py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <span className="font-mono text-xs uppercase tracking-widest text-primary">02 · For AI companies</span>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">How it works for clients</h2>
          {/* A flow, not a numbered list — each stage gets its own icon and
              color, connected by an arrow instead of a "1, 2, 3, 4" count.
              Same dark-bento field as FeatureBento, so this reads as the
              same design language as the card grids rather than a one-off. */}
          <div className="relative mt-10 overflow-hidden rounded-3xl bg-navy p-6 sm:p-8">
            <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-accent-violet/25 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-24 size-72 rounded-full bg-primary/20 blur-3xl" />
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-4">
              {CLIENT_STEPS.map((step, i) => (
                <Fragment key={step.title}>
                  <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
                    <IconChip icon={step.icon} index={i} />
                    <div>
                      <h3 className="text-sm font-semibold text-white">{step.title}</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-white/60">{step.desc}</p>
                    </div>
                  </div>
                  {i < CLIENT_STEPS.length - 1 ? (
                    <div className="hidden shrink-0 items-center justify-center text-white/25 lg:flex" aria-hidden="true">
                      <ArrowRight className="size-5" />
                    </div>
                  ) : null}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How registration works — the real applicant flow, made visible */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <div>
              <span className="font-mono text-xs uppercase tracking-widest text-primary">03 · For experts</span>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                Your path to project eligibility
              </h2>
              <p className="mt-4 max-w-md text-muted-foreground">
                See the application, assessment, review, readiness and identity stages below.
                Completing them makes you eligible for matching; paid work depends on project availability.
              </p>
              <Button size="lg" variant="violet" className="mt-6" asChild>
                <Link href="/apply">
                  Start your application <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
            <RegistrationSteps />
          </div>
        </div>
      </section>

      {/* Expert network — the dark band keeps the map's light-blue dots and
          connections legible (they're tuned for a dark backdrop) and reads
          as a deliberate accent, the same way the homepage hero used to
          before it was lightened — just scoped to this one section rather
          than site-wide. The category cards sit below on the page's normal
          light surface, not inside the dark band. */}
      <section className="border-b border-border">
        <div className="relative overflow-hidden bg-navy py-16 text-white">
          <WorldNetworkMap opacity={0.6} tone="dark" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,color-mix(in_oklch,var(--accent-violet)_35%,transparent),transparent_55%)]" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-accent-cyan">
                  <Globe2 className="size-3.5" /> 04 · Global network
                </span>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  A verified network across every domain
                </h2>
                <p className="mt-3 max-w-xl text-white/70">
                  Trainers and experts are vetted through identity checks and domain assessments before working on
                  live projects.
                </p>
              </div>
              <Button variant="outline" className="border-white/25 bg-transparent text-white hover:bg-white/10" asChild>
                <Link href="/for-companies">Explore the expert network</Link>
              </Button>
            </div>
          </div>
        </div>
        <div className="bg-surface py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {EXPERT_CATEGORIES.map((c, i) => (
                <div
                  key={c.label}
                  className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
                >
                  <IconChip icon={c.icon} index={i} />
                  <span className="text-sm font-medium">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Quality */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <span className="font-mono text-xs uppercase tracking-widest text-accent-violet">05 · Quality control</span>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Quality is the product</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Every dataset moves through a structured pipeline before it reaches you — never a single unreviewed
            submission.
          </p>
          <div className="mt-10">
            <FeatureBento items={QUALITY_POINTS} />
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="border-y border-border bg-surface py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <span className="font-mono text-xs uppercase tracking-widest text-primary">06 · Security</span>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Enterprise-grade security by default
          </h2>
          <div className="mt-10">
            <FeatureBento items={SECURITY_POINTS} />
          </div>
        </div>
      </section>

      {/* Trainer section */}
      <section className="border-y border-border py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
          <div>
            <span className="font-mono text-xs uppercase tracking-widest text-primary">07 · For experts</span>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Get paid to improve the world&apos;s most advanced AI systems.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Join a network of specialists and generalists doing meaningful, well-compensated work that
              shapes how AI systems behave — no subject-matter background required to start.
            </p>
            <Button size="lg" variant="violet" className="mt-6" asChild>
              <Link href="/apply">
                Apply to join <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {TRAINER_BENEFITS.map((b) => (
              <li key={b} className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm">
                <Wallet className="mt-0.5 size-4 shrink-0 text-primary" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <MessageSquareQuote className="mx-auto size-8 text-accent-violet" />
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">
            Ready to build a higher-quality training data pipeline?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Talk to our team about your evaluation, RLHF, or red-teaming needs.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" variant="violet" asChild>
              <Link href="/contact">Book a demo</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/apply">Become an AI trainer</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
