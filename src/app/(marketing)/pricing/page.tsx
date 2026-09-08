import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import { MarketingPageHero } from "@/components/marketing/page-hero";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Traivr pricing for AI training data services — RLHF, evaluations, red teaming, and expert data creation, scaled from pilot projects to production volume.",
};

const TIERS = [
  {
    name: "Pilot",
    price: "Custom",
    desc: "For teams validating a use case with a small, well-scoped dataset.",
    features: ["Up to 2 active projects", "Standard quality review", "Email support", "Self-serve project setup"],
  },
  {
    name: "Scale",
    price: "Custom",
    desc: "For teams running ongoing evaluation, RLHF, or SFT pipelines.",
    features: ["Unlimited projects", "Multi-stage review & adjudication", "Dedicated onboarding", "API access & webhooks"],
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    desc: "For organizations with advanced security, volume, or compliance needs.",
    features: ["Custom security review", "SSO-ready architecture", "Dedicated operations manager", "Custom SLAs"],
  },
];

export default function PricingPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Pricing"
        title="Pricing that scales with your data needs"
        description="Every engagement is scoped to your task type, volume, and quality bar. Talk to our team for a tailored quote."
      />
      <section className="py-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-3 lg:px-8">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-2xl border p-6",
                t.highlighted
                  ? "border-transparent bg-navy text-white shadow-xl lg:-translate-y-3"
                  : "border-border bg-card"
              )}
            >
              {t.highlighted ? (
                <>
                  <div className="pointer-events-none absolute -top-20 -right-20 size-56 rounded-full bg-accent-violet/25 blur-3xl" />
                  <span className="relative mb-4 inline-flex w-fit items-center rounded-full bg-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white/80">
                    For ongoing projects
                  </span>
                </>
              ) : null}
              <div className="relative">
                <h3 className="text-base font-semibold">{t.name}</h3>
                <p className="text-2xl font-semibold">{t.price}</p>
                <p className={cn("mt-1 text-sm", t.highlighted ? "text-white/60" : "text-muted-foreground")}>{t.desc}</p>
              </div>
              <ul className="relative mt-6 space-y-2">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
                        t.highlighted ? "bg-white/15" : "bg-success/15"
                      )}
                    >
                      <CheckCircle2 className={cn("size-3", t.highlighted ? "text-white" : "text-success")} />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                className="relative mt-6 w-full"
                variant={t.highlighted ? "violet" : "outline"}
                asChild
              >
                <Link href="/contact">Talk to sales</Link>
              </Button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
