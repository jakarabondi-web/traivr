import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { MarketingPageHero } from "@/components/marketing/page-hero";
import { Button } from "@/components/ui/button";
import { RegistrationSteps } from "@/components/marketing/registration-steps";

export const metadata: Metadata = {
  title: "Apply to join",
  description:
    "Apply to join Traivr's verified trainer network. RLHF, evaluations, red teaming, and expert data work for AI companies — open to specialists and generalists.",
};

export default function ApplyPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Apply to join"
        title="Join the Traivr trainer network"
        description="Choose a specialist track or General assistant. Application and assessment time varies by track; review and identity checks are separate stages. Complete the steps below to become eligible for project matching."
      />
      <section className="py-16">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
          <RegistrationSteps />
          <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" />
            No cost to apply. Project pay rates are shown before you accept work. Availability and matching are not guaranteed.
          </div>
          <Button size="lg" variant="violet" className="mt-6 w-full sm:w-auto" asChild>
            <Link href="/register?role=trainer">
              Start your application <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
