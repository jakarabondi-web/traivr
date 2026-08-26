import { prisma } from "@/lib/db/prisma";
import { krippendorffAlpha, type Rating } from "@/lib/analytics/agreement";
import { recomputeQualityScore } from "@/server/services/quality";
import { postEarningApproved, postEarningReversed } from "@/server/services/ledger";

export class AdjudicationError extends Error {}

/**
 * Opens an adjudication when reviewers disagree or a reviewer escalates.
 * Idempotent — a submission already queued isn't queued twice.
 */
export async function openAdjudication(params: { submissionId: string; reason: string }) {
  const existing = await prisma.adjudication.findUnique({
    where: { submissionId: params.submissionId },
  });
  if (existing) return existing;

  return prisma.adjudication.create({
    data: { submissionId: params.submissionId, reason: params.reason, status: "PENDING" },
  });
}

/**
 * Scans reviewed submissions for reviewer disagreement and queues the
 * conflicted ones. Intended to run after review, or periodically.
 */
export async function detectDisagreements(projectId?: string) {
  const submissions = await prisma.taskSubmission.findMany({
    where: {
      ...(projectId ? { task: { projectId } } : {}),
      reviews: { some: {} },
      adjudication: null,
    },
    include: { reviews: { select: { decision: true } } },
    take: 500,
  });

  let opened = 0;
  for (const s of submissions) {
    if (s.reviews.length < 2) continue;
    const distinct = new Set(s.reviews.map((r) => r.decision));
    if (distinct.size > 1) {
      await openAdjudication({ submissionId: s.id, reason: "consensus_disagreement" });
      opened++;
    }
  }
  return opened;
}

/** Everything waiting on a lead reviewer, oldest first. */
export async function getAdjudicationQueue(limit = 50) {
  return prisma.adjudication.findMany({
    where: { status: "PENDING" },
    include: {
      submission: {
        include: {
          task: { include: { project: true, goldTask: true } },
          reviews: { include: { reviewer: true, scores: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

/**
 * Records a lead reviewer's binding decision.
 *
 * This overrides the reviewers below it, so it also corrects the downstream
 * consequences: an overturned rejection creates the earning the trainer
 * should have had, and an overturned approval reverses one that shouldn't
 * have been created.
 */
export async function resolveAdjudication(params: {
  adjudicationId: string;
  adjudicatorId: string;
  decision: "APPROVED" | "REVISION_REQUESTED" | "REJECTED";
  notes: string;
}) {
  const adjudication = await prisma.adjudication.findUnique({
    where: { id: params.adjudicationId },
    include: {
      submission: {
        include: { task: { include: { project: true } }, reviews: true },
      },
    },
  });

  if (!adjudication) throw new AdjudicationError("Adjudication not found.");
  if (adjudication.status === "RESOLVED") throw new AdjudicationError("Already resolved.");

  const submission = adjudication.submission;

  // Separation of duties, enforced here rather than in the caller because
  // this is the function that moves money.
  //
  // A LEAD_REVIEWER is a trainer role, so the same person can submit work
  // and adjudicate. Without this, they could take their own rejected
  // submission to adjudication, approve it, and mint the earning below for
  // themselves. submitReview already refuses self-review; this closes the
  // same hole one level up.
  if (submission.submittedById === params.adjudicatorId) {
    throw new AdjudicationError("You can't adjudicate your own submission.");
  }

  // Adjudication exists to settle a disagreement *between* reviewers. Ruling
  // on a review you wrote yourself is not a second opinion. Staff who never
  // reviewed the submission remain able to resolve it, so a queue cannot
  // deadlock.
  if (submission.reviews.some((r) => r.reviewerId === params.adjudicatorId)) {
    throw new AdjudicationError(
      "You reviewed this submission, so someone else has to adjudicate it."
    );
  }
  const previouslyApproved = submission.reviews.some((r) => r.decision === "APPROVED");
  const nowApproved = params.decision === "APPROVED";

  await prisma.$transaction(async (tx) => {
    await tx.adjudication.update({
      where: { id: params.adjudicationId },
      data: {
        status: "RESOLVED",
        finalDecision: params.decision,
        notes: params.notes,
        adjudicatedBy: params.adjudicatorId,
        adjudicatedAt: new Date(),
      },
    });

    await tx.task.update({
      where: { id: submission.taskId },
      data: {
        status:
          params.decision === "APPROVED"
            ? "APPROVED"
            : params.decision === "REJECTED"
              ? "REJECTED"
              : "REVISION_REQUESTED",
      },
    });

    // Overturned rejection — the trainer was owed this.
    if (nowApproved && !previouslyApproved) {
      const pay = submission.task.project.payPerTaskCents ?? 0;
      const earning = await tx.earning.create({
        data: {
          userId: submission.submittedById,
          projectId: submission.task.projectId,
          taskCount: 1,
          baseCents: pay,
          status: "APPROVED",
        },
      });
      if (pay > 0) {
        await postEarningApproved(tx, {
          earningId: earning.id,
          userId: submission.submittedById,
          amountCents: pay,
          actorId: params.adjudicatorId,
          description: "Earning approved on adjudication (rejection overturned)",
        });
      }
    }

    // Overturned approval — reverse rather than delete, so the correction
    // stays visible in the trainer's history instead of money silently
    // vanishing from their wallet.
    if (!nowApproved && previouslyApproved) {
      const earning = await tx.earning.findFirst({
        where: {
          userId: submission.submittedById,
          projectId: submission.task.projectId,
          status: { in: ["APPROVED", "PENDING_REVIEW"] },
          payoutRequestId: null,
        },
        orderBy: { createdAt: "desc" },
      });
      if (earning) {
        await tx.earning.update({ where: { id: earning.id }, data: { status: "REVERSED" } });
        // Reverse the ledger only if the approval was ever booked — a
        // pending-review earning never reached the journal, so reversing
        // it there would fabricate a correction for money never recorded.
        const approvedPosting = await tx.ledgerTransaction.findUnique({
          where: {
            sourceType_sourceId_kind: {
              sourceType: "Earning",
              sourceId: earning.id,
              kind: "earning.approved",
            },
          },
        });
        if (approvedPosting) {
          const amount = earning.baseCents + earning.bonusCents + earning.adjustmentCents;
          await postEarningReversed(tx, {
            earningId: earning.id,
            userId: submission.submittedById,
            amountCents: amount,
            actorId: params.adjudicatorId,
            description: "Earning reversed on adjudication (approval overturned)",
          });
        }
      }
    }

    await tx.notification.create({
      data: {
        userId: submission.submittedById,
        type: "adjudication_resolved",
        title:
          params.decision === "APPROVED"
            ? "A lead reviewer approved your submission"
            : "A lead reviewer reviewed your submission",
        body: params.notes,
        link: `/trainer/tasks/${submission.taskId}`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: params.adjudicatorId,
        action: "review.adjudicated",
        entityType: "TaskSubmission",
        entityId: submission.id,
        metadata: {
          decision: params.decision,
          reason: adjudication.reason,
          overturned: nowApproved !== previouslyApproved,
        },
      },
    });
  });

  // The lead reviewer's call is binding and can reverse what the raw review
  // decisions said — quality scoring has to reflect the outcome that
  // actually stood, not the overturned one.
  await recomputeQualityScore(submission.submittedById);

  return { decision: params.decision, overturned: nowApproved !== previouslyApproved };
}

/** Reviewer calibration: how often each reviewer is overturned on adjudication. */
export async function getReviewerCalibration() {
  const resolved = await prisma.adjudication.findMany({
    where: { status: "RESOLVED" },
    include: { submission: { include: { reviews: { include: { reviewer: true } } } } },
  });

  const byReviewer = new Map<
    string,
    { name: string; total: number; agreed: number }
  >();

  const ratings: Rating[] = [];

  for (const a of resolved) {
    for (const r of a.submission.reviews) {
      const key = r.reviewerId;
      const entry = byReviewer.get(key) ?? {
        name: `${r.reviewer.firstName} ${r.reviewer.lastName}`,
        total: 0,
        agreed: 0,
      };
      entry.total++;
      if (r.decision === a.finalDecision) entry.agreed++;
      byReviewer.set(key, entry);

      ratings.push({ itemId: a.submissionId, raterId: key, value: r.decision });
    }
  }

  return {
    reviewers: [...byReviewer.entries()].map(([id, v]) => ({
      reviewerId: id,
      name: v.name,
      reviewsAdjudicated: v.total,
      agreementWithLead: v.total > 0 ? v.agreed / v.total : null,
    })),
    overallAlpha: krippendorffAlpha(ratings),
  };
}
