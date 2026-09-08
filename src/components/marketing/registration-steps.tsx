"use client";

import { useEffect, useRef, useState } from "react";
import { UserPlus, ClipboardList, ClipboardCheck, Fingerprint, Rocket } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { ICON_BADGE_COLORS } from "@/lib/constants/icon-colors";

type RegistrationStepData = {
  code: string;
  title: string;
  desc: string;
  icon: typeof UserPlus;
};

// Defined here, not passed in as a prop from the server page — Lucide icon
// components are function references, and functions can't cross the
// server → client serialization boundary as props.
//
// Mirrors the real applicant flow (src/lib/permissions/onboarding-steps.ts)
// — a progress claim on the marketing page has to match what actually
// happens after signup, not a simplified or aspirational version of it.
const REGISTRATION_STEPS: RegistrationStepData[] = [
  { code: "ACCOUNT", title: "Create your account", desc: "Register and verify your email before signing in.", icon: UserPlus },
  { code: "APPLICATION", title: "Submit your application", desc: "Tell us about your background, domain, skills and languages.", icon: ClipboardList },
  { code: "ASSESSMENT", title: "Complete screening and qualification", desc: "Pass the screening quiz, then the qualification exam in your chosen track.", icon: ClipboardCheck },
  { code: "REVIEW", title: "Wait for application review", desc: "Our operations team reviews your application and assessment before deciding on approval.", icon: ClipboardCheck },
  { code: "READINESS", title: "Complete readiness calibration", desc: "After approval, complete the calibration tasks for your domain.", icon: ClipboardList },
  { code: "IDENTITY", title: "Verify your identity", desc: "Complete identity verification as the final check before accessing client work.", icon: Fingerprint },
  { code: "MATCHING", title: "Explore available projects", desc: "Apply for projects that fit your skills. Approval does not guarantee a match or paid work.", icon: Rocket },
];

function StepRow({ step, index }: { step: RegistrationStepData; index: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3, rootMargin: "0px 0px -10% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <li
      ref={ref}
      className={cn(
        "relative flex gap-5 pb-12 transition-all duration-700 ease-out last:pb-0",
        visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      )}
      style={{ transitionDelay: `${index * 90}ms` }}
    >
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl border-2 shadow-sm transition-all duration-500",
            visible
              ? cn("border-transparent shadow-primary/10", ICON_BADGE_COLORS[index % ICON_BADGE_COLORS.length])
              : "border-border bg-card text-muted-foreground shadow-none"
          )}
        >
          <step.icon className="size-5" />
        </span>
        <span className="mt-3 flex-1 w-px bg-gradient-to-b from-border to-transparent last:hidden" aria-hidden="true" />
      </div>
      <div className="pt-1.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-primary">{step.code}</span>
        <h3 className="mt-1 text-lg font-semibold tracking-tight">{step.title}</h3>
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{step.desc}</p>
      </div>
    </li>
  );
}

export function RegistrationSteps() {
  return (
    <ol className="relative" aria-label="Application stages">
      {REGISTRATION_STEPS.map((step, i) => (
        <StepRow key={step.code} step={step} index={i} />
      ))}
    </ol>
  );
}
