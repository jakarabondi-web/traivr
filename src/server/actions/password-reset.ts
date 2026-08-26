"use server";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { headers } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import { checkRateLimit, clientIpFrom } from "@/lib/security/rate-limit";
import { sendEmail } from "@/lib/email/client";
import { brand } from "@/config/brand";
import { appUrl } from "@/lib/app-url";

const RESET_TOKEN_TTL_MINUTES = 30;

const forgotSchema = z.object({ email: z.string().email() });

export type ForgotPasswordState = { status: "idle" | "success"; };

export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const parsed = forgotSchema.safeParse({ email: formData.get("email") });

  // Always return success to avoid leaking whether an email is registered.
  if (!parsed.success) return { status: "success" };

  // Throttled per IP and per target address; the response stays the same
  // "success" either way so the limiter is as silent about registered
  // emails as the rest of this action. This is what keeps one IP from
  // using the reset form to flood a person's inbox.
  const [byIp, byEmail] = await Promise.all([
    checkRateLimit({
      bucket: "pw-reset-ip",
      id: clientIpFrom(await headers()),
      limit: 5,
      windowMs: 15 * 60_000,
    }),
    checkRateLimit({
      bucket: "pw-reset-email",
      id: parsed.data.email.toLowerCase(),
      limit: 3,
      windowMs: 15 * 60_000,
    }),
  ]);
  if (!byIp.ok || !byEmail.ok) return { status: "success" };

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: token,
        passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
      },
    });

    const resetUrl = `${appUrl()}/reset-password?token=${token}`;
    await sendEmail({
      to: user.email,
      subject: `Reset your ${brand.name} password`,
      html: `<p>Click the link below to reset your password. This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    });
  }

  return { status: "success" };
}

const resetSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordState = {
  status: "idle" | "success" | "error";
  formError?: string;
};

export async function resetPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { status: "error", formError: parsed.error.issues[0]?.message ?? "Invalid submission" };
  }

  const user = await prisma.user.findUnique({ where: { passwordResetToken: parsed.data.token } });
  if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
    return { status: "error", formError: "This reset link is invalid or has expired." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  return { status: "success" };
}
