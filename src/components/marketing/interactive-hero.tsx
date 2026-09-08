"use client";

import { useState } from "react";
import { ArrowRight, Check, RotateCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * A working miniature of the pairwise-comparison task, so a visitor
 * experiences the product in the hero rather than reading about it.
 * Deliberately self-contained: no network calls, no persistence.
 */

type Sample = {
  prompt: string;
  domain: string;
  a: string;
  b: string;
  /** Suggested answer for this illustrative example, and why. */
  expertPick: "a" | "b";
  rationale: string;
};

const SAMPLES: Sample[] = [
  {
    prompt: "Explain the difference between TCP and UDP to a junior developer.",
    domain: "Software engineering",
    a: "TCP is connection-oriented and reliable. UDP is connectionless and faster, but packets can be lost.",
    b: "TCP does a handshake first and guarantees ordered delivery, retransmitting anything lost — good for file transfers and web pages. UDP skips the handshake and sends without delivery guarantees, which suits live video or gaming where being fast matters more than being complete.",
    expertPick: "b",
    rationale:
      "Both are factually correct, but B explains the mechanism behind the tradeoff and grounds it in when you'd choose each. A states the conclusion without the reasoning.",
  },
  {
    prompt: "A patient reports mild chest discomfort after exercise. What should they do?",
    domain: "Medicine",
    a: "That's usually just muscle strain from exertion. Try resting and taking an over-the-counter painkiller, and it should clear up in a day or two.",
    b: "Exercise-related chest discomfort can have causes ranging from muscle strain to cardiac issues, and it isn't safe to distinguish them without an examination. They should contact a clinician promptly — and seek emergency care if it comes with shortness of breath, radiating pain, nausea, or sweating.",
    expertPick: "b",
    rationale:
      "A offers a confident benign diagnosis it has no basis for, which is the failure mode that matters most in medical contexts. B is appropriately calibrated and gives concrete escalation criteria.",
  },
  {
    prompt: "Is this contract clause enforceable? 'Employee agrees never to work in this industry again.'",
    domain: "Law",
    a: "No, that clause is unenforceable. Non-competes with no time limit are always void.",
    b: "That clause is likely unenforceable in most jurisdictions — non-competes are typically assessed on reasonableness of duration, geography, and scope, and an unlimited lifetime ban usually fails all three. But enforceability varies significantly by jurisdiction, so this needs review against the governing law named in the contract.",
    expertPick: "b",
    rationale:
      "A is directionally right but overgeneralizes with 'always' and ignores jurisdictional variance. B reaches the same conclusion while accurately representing the uncertainty.",
  },
];

export function InteractiveHero() {
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<"a" | "b" | null>(null);

  const sample = SAMPLES[index];
  const revealed = choice !== null;
  const matched = choice === sample.expertPick;

  function pick(side: "a" | "b") {
    if (revealed) return;
    setChoice(side);
  }

  function next() {
    setIndex((i) => (i + 1) % SAMPLES.length);
    setChoice(null);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-navy p-3 shadow-xl shadow-primary/10 sm:p-4">
      <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-accent-violet/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-16 size-48 rounded-full bg-primary/20 blur-3xl" />

      <div className="relative mb-3 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-accent-violet/15 text-accent-violet">
            <Sparkles className="size-3.5" />
          </span>
          <p className="text-xs font-medium text-white/60">
            Try a sample task · {sample.domain}
          </p>
        </div>
        <p className="text-[11px] tabular-nums text-white/40">
          {index + 1} / {SAMPLES.length}
        </p>
      </div>

      <div className="relative rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
        <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-white/50">
          Prompt
        </p>
        <p className="mt-1.5 text-sm font-medium text-white">{sample.prompt}</p>

        <p className="mt-4 font-mono text-[11px] font-medium uppercase tracking-wide text-white/50">
          Which response is better?
        </p>

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(["a", "b"] as const).map((side) => {
            const isChoice = choice === side;
            const isExpert = sample.expertPick === side;
            return (
              <button
                key={side}
                type="button"
                onClick={() => pick(side)}
                disabled={revealed}
                aria-label={`Choose response ${side.toUpperCase()}`}
                className={cn(
                  // flex flex-col items-stretch: buttons vertically center
                  // their content by default once the box is taller than its
                  // content (as this one is, next to the longer response) —
                  // without this the label drifts away from the box's top.
                  "flex flex-col items-stretch rounded-lg border-2 p-3 text-left transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !revealed &&
                    "cursor-pointer border-white/10 hover:-translate-y-0.5 hover:border-primary hover:bg-white/[0.06] hover:shadow-md",
                  revealed && isExpert && "border-success bg-success/10 shadow-md shadow-success/10",
                  revealed && !isExpert && "border-white/5 opacity-50"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-semibold text-white/60">
                    Response {side.toUpperCase()}
                  </span>
                  {revealed && isExpert ? (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-success">
                      <Check className="size-3" /> Sample answer
                    </span>
                  ) : null}
                  {revealed && isChoice && !isExpert ? (
                    <span className="text-[10px] font-semibold text-white/50">You picked</span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-white/80">
                  {side === "a" ? sample.a : sample.b}
                </p>
              </button>
            );
          })}
        </div>

        {revealed ? (
          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <p
              className={cn(
                "text-xs font-semibold",
                matched ? "text-success" : "text-warning"
              )}
            >
              {matched ? "You matched the sample answer." : "Compare your choice with the sample rationale."}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/60">{sample.rationale}</p>
            <button
              type="button"
              onClick={next}
              className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-accent-cyan hover:underline"
            >
              <RotateCcw className="size-3" />
              Try another task
            </button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-white/50">
            Illustrative practice task. Choose a response to see the sample rationale.
            Your choice is not submitted or scored as an application assessment.
          </p>
        )}
      </div>
    </div>
  );
}

export function HeroCta() {
  return (
    <Button size="lg" variant="violet" asChild>
      <a href="/contact">
        Book a demo <ArrowRight className="size-4" />
      </a>
    </Button>
  );
}
