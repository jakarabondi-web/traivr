import { prisma } from "@/lib/db/prisma";
import { krippendorffAlpha, type Rating } from "@/lib/analytics/agreement";
import { openAdjudication } from "@/server/services/adjudication";
import { postEarningApproved } from "@/server/services/ledger";
import { recomputeQualityScore } from "@/server/services/quality";
import { dispatchWebhookEvent } from "@/server/services/webhooks";

export class ReviewError extends Error {}

/**
 * Pulls the next submission a reviewer should look at.
 *
 * Ordering is deliberate: oldest-first so nothing starves, and a reviewer
 * never reviews their own work.
 */
export async function getReviewQueue(reviewerId: string, limit = 25) {
  return prisma.taskSubmission.findMany({
    where: {
      reviews: { none: {} },
      submittedById: { not: reviewerId },
      task: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
      // A submission auto-escalated to adjudication (e.g. a high-confidence
      // plagiarism match) is out of ordinary peer review entirely, not just
      // flagged within it — see checkSubmissionSimilarity. Otherwise it
      // would sit in both queues at once, and a peer reviewer could approve
      // it before adjudication ever looked at it.
      adjudication: null,
    },
    include: { task: { include: { project: true } } },
    orderBy: { submittedAt: "asc" },
    take: limit,
  });
}

/**
 * Loads a submission for review with the trainer's identity withheld.
 *
 * Reviewers see the work, not who produced it — blind review measurably
 * reduces bias, and the spec requires reviewers not see hidden identity
 * information unless authorized.
 */
export async function loadSubmissionForReview(submissionId: string, reviewerId: string) {
  const submission = await prisma.taskSubmission.findUnique({
    where: { id: submissionId },
    include: {
      task: { include: { project: { include: { rubrics: true } }, goldTask: true } },
      reviews: { include: { scores: true } },
      adjudication: true,
    },
  });

  if (!submission) throw new ReviewError("Submission not found.");
  if (submission.submittedById === reviewerId) {
    throw new ReviewError("You can't review your own submission.");
  }
  // Belt-and-suspenders against the queue filter above: blocks a direct link
  // to a submission that's been pulled into adjudication (e.g. a bookmarked
  // tab, or one opened before the escalation happened) from being decided
  // through ordinary peer review instead.
  if (submission.adjudication) {
    throw new ReviewError("This submission is under adjudication, not ordinary review.");
  }

  return {
    id: submission.id,
    version: submission.version,
    content: submission.content,
    durationSeconds: submission.durationSeconds,
    submittedAt: submission.submittedAt,
    task: submission.task,
    priorReviews: submission.reviews,
    /** Present only for gold tasks — the known-correct answer. */
    goldAnswer: submission.task.goldTask?.expectedAnswer ?? null,
    // Deliberately omitted: submittedById and any trainer profile data.
  };
}

/**
 * Records a review decision and advances the task's state.
 *
 * Approving creates the trainer's earning — that's the single place work
 * turns into money, so it stays in the same transaction as the decision.
 */
export async function submitReview(params: {
  submissionId: string;
  reviewerId: string;
  decision: "APPROVED" | "REVISION_REQUESTED" | "REJECTED" | "ESCALATED";
  feedback: string;
  confidence: number;
  severity?: string;
  scores: Array<{ category: string; score: number }>;
}) {
  const submission = await prisma.taskSubmission.findUnique({
    where: { id: params.submissionId },
    include: { task: { include: { project: true } } },
  });
  if (!submission) throw new ReviewError("Submission not found.");
  if (submission.submittedById === params.reviewerId) {
    throw new ReviewError("You can't review your own submission.");
  }

  const alreadyReviewed = await prisma.review.findFirst({
    where: { submissionId: params.submissionId, reviewerId: params.reviewerId },
  });
  if (alreadyReviewed) throw new ReviewError("You've already reviewed this submission.");

  const nextTaskStatus =
    params.decision === "APPROVED"
      ? "APPROVED"
      : params.decision === "REJECTED"
        ? "REJECTED"
        : params.decision === "ESCALATED"
          ? "ESCALATED"
          : "REVISION_REQUESTED";

  const notificationCopy = {
    APPROVED: { title: "Your submission was approved", body: params.feedback || "Nice work." },
    REVISION_REQUESTED: { title: "Revision requested", body: params.feedback },
    REJECTED: { title: "Submission not accepted", body: params.feedback },
    ESCALATED: {
      title: "Your submission was escalated",
      body: "A lead reviewer is taking a second look. No action needed from you.",
    },
  }[params.decision];

  await prisma.$transaction(async (tx) => {
    await tx.review.create({
      data: {
        submissionId: params.submissionId,
        reviewerId: params.reviewerId,
        decision: params.decision,
        feedback: params.feedback || null,
        severity: params.severity,
        confidence: params.confidence,
        scores: {
          create: params.scores.map((s) => ({ category: s.category, score: s.score })),
        },
      },
    });

    await tx.task.update({
      where: { id: submission.taskId },
      data: { status: nextTaskStatus },
    });

    // Approval is what creates payable work.
    if (params.decision === "APPROVED") {
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
      // Money owed to a trainer enters the books the moment it exists.
      if (pay > 0) {
        await postEarningApproved(tx, {
          earningId: earning.id,
          userId: submission.submittedById,
          amountCents: pay,
          actorId: params.reviewerId,
          description: `Task approved on ${submission.task.project.name}`,
        });
      }
    }

    // A gold task the trainer got wrong is the strongest quality signal we
    // have — record it whichever way it went.
    if (submission.task.isGold) {
      await tx.goldTaskResult.create({
        data: {
          goldTaskId: submission.task.id,
          userId: submission.submittedById,
          submissionId: submission.id,
          passed: params.decision === "APPROVED",
        },
      });
    }

    await tx.notification.create({
      data: {
        userId: submission.submittedById,
        type: "task_reviewed",
        title: notificationCopy.title,
        body: notificationCopy.body || undefined,
        link: `/trainer/tasks/${submission.taskId}`,
      },
    });
  });

  // Every decision on real work — and every gold-task result, recorded
  // above when this submission was one — is exactly the evidence quality
  // scoring runs on, so it has to stay current with each one, not just at
  // approval time.
  await recomputeQualityScore(submission.submittedById);

  // Fire-and-forget: a slow or dead client endpoint must not hold up the
  // reviewer's request. dispatchWebhookEvent never throws — every outcome,
  // including delivery failure, is recorded in WebhookDelivery instead.
  void dispatchWebhookEvent(submission.task.project.organizationId, "task.reviewed", {
    task_id: submission.taskId,
    external_ref: submission.task.externalRef,
    submission_id: submission.id,
    decision: params.decision,
    project_id: submission.task.projectId,
  });

  // Escalation goes straight to a lead reviewer. Disagreement between
  // reviewers is detected here too, so a conflict never sits unnoticed.
  if (params.decision === "ESCALATED") {
    await openAdjudication({ submissionId: params.submissionId, reason: "escalated" });
  } else {
    const all = await prisma.review.findMany({
      where: { submissionId: params.submissionId },
      select: { decision: true },
    });
    if (all.length > 1 && new Set(all.map((r) => r.decision)).size > 1) {
      await openAdjudication({
        submissionId: params.submissionId,
        reason: "consensus_disagreement",
      });
    }
  }

  return { taskStatus: nextTaskStatus };
}

/** Reviewer's own calibration stats, for the reviewer dashboard. */
export async function getReviewerStats(reviewerId: string) {
  const reviews = await prisma.review.findMany({
    where: { reviewerId },
    select: { decision: true, createdAt: true, submissionId: true },
  });

  // Agreement against other reviewers who saw the same submission.
  const submissionIds = reviews.map((r) => r.submissionId);
  const peers = submissionIds.length
    ? await prisma.review.findMany({
        where: { submissionId: { in: submissionIds } },
        select: { submissionId: true, reviewerId: true, decision: true },
      })
    : [];

  const ratings: Rating[] = peers.map((p) => ({
    itemId: p.submissionId,
    raterId: p.reviewerId,
    value: p.decision,
  }));

  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  return {
    total: reviews.length,
    thisWeek: reviews.filter((r) => r.createdAt >= weekAgo).length,
    approvedShare: reviews.length
      ? reviews.filter((r) => r.decision === "APPROVED").length / reviews.length
      : null,
    peerAgreement: krippendorffAlpha(ratings),
  };
}
