import type { TrainerGateState } from "@/lib/permissions/gating";

/**
 * The applicant-facing view of `evaluateTrainerGate`.
 *
 * Derived from the gate rather than tracked separately, for the same reason
 * the gate's own copy is: a progress bar that drifts from what the server
 * enforces is worse than no progress bar, because it tells someone they are
 * further along than they are.
 */

export type OnboardingStepStatus = "done" | "current" | "upcoming";

export type OnboardingStepKey = "application" | "assessment" | "review" | "readiness" | "identity" | "approved";

export type OnboardingStep = {
  key: OnboardingStepKey;
  label: string;
  /** What this stage means, in the applicant's terms. */
  description: string;
  status: OnboardingStepStatus;
  /** Only set on the step someone can act on right now. */
  href?: string;
};

const STEPS: { key: OnboardingStepKey; label: string; description: string; href?: string }[] = [
  {
    key: "application",
    label: "Application",
    description: "Tell us your background and areas of expertise.",
    href: "/trainer/onboarding",
  },
  {
    key: "assessment",
    label: "Assessment",
    description: "Pass the screening quiz, then the qualification exam in your track.",
    href: "/trainer/assessments",
  },
  {
    key: "review",
    label: "Review",
    description: "Our team checks everything over.",
  },
  {
    key: "readiness",
    label: "Readiness",
    description: "Complete a short set of calibration tasks so we know what you're strongest at.",
    href: "/trainer/readiness",
  },
  {
    key: "identity",
    label: "Identity",
    description: "Upload a photo ID and take a selfie to confirm it's you — the last step before paid work.",
    href: "/trainer/verification",
  },
  {
    key: "approved",
    label: "Approved",
    description: "Explore available projects. Matching and paid work are not guaranteed.",
  },
];

/** Which step a given gate stage is sitting on. */
const STAGE_POSITION: Record<TrainerGateState["stage"], number | null> = {
  application_not_started: 0,
  more_info_required: 0,
  assessment_required: 1,
  under_review: 2,
  readiness_required: 3,
  identity_required: 4,
  identity_processing: 4,
  approved: 5,
  // Terminal outcomes. A progress bar implies a road still ahead, so these
  // deliberately render no stepper at all — the banner carries the message.
  rejected: null,
  waitlisted: null,
  suspended: null,
};

/**
 * Returns the onboarding steps with their status, or `null` when a
 * stepper would be misleading (a decided or paused application).
 */
export function onboardingSteps(gate: TrainerGateState): OnboardingStep[] | null {
  const position = STAGE_POSITION[gate.stage];
  if (position === null) return null;

  const everythingDone = gate.stage === "approved";

  return STEPS.map((step, index) => {
    const status: OnboardingStepStatus =
      everythingDone || index < position ? "done" : index === position ? "current" : "upcoming";

    return {
      key: step.key,
      label: step.label,
      description: step.description,
      status,
      // Only the active step is actionable — linking a future step invites
      // someone to start work the gate will just turn away.
      href: status === "current" ? step.href : undefined,
    };
  });
}
