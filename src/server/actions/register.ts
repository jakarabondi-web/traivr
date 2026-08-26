"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";

import { headers } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import { checkRateLimit, clientIpFrom } from "@/lib/security/rate-limit";
import type { GlobalRole } from "@/lib/permissions/roles";
import { issueEmailVerification } from "@/server/services/email-verification";

const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["TRAINER", "CLIENT_ADMIN"]),
  // Enforced server-side too, not just via the disabled submit button — a
  // request built without JS (or with the button re-enabled by hand)
  // shouldn't be able to skip agreeing to the contractor/terms language.
  termsAccepted: z.literal("true", "You must accept the terms to continue"),
});

export type RegisterState = {
  status: "idle" | "success" | "error";
  /**
   * Present only when this deployment cannot send email. Lets the sign-up
   * screen show the confirmation link instead of pointing someone at an inbox
   * that will never receive anything.
   */
  verificationUrl?: string;
  /** Email is configured but the send failed — the account still exists. */
  emailSendFailed?: boolean;
  errors?: Partial<Record<keyof z.infer<typeof registerSchema>, string>>;
  formError?: string;
};

export async function registerUser(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  // Each signup creates a row and sends a verification email — both worth
  // protecting from a scripted loop. Ten per IP per hour is far above any
  // honest use of a signup form.
  const throttle = await checkRateLimit({
    bucket: "register",
    id: clientIpFrom(await headers()),
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!throttle.ok) {
    return {
      status: "error",
      formError: "Too many sign-up attempts from this network. Try again later.",
    };
  }

  const parsed = registerSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
    termsAccepted: formData.get("termsAccepted"),
  });

  if (!parsed.success) {
    const errors: RegisterState["errors"] = {};
    let formError: string | undefined;
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof z.infer<typeof registerSchema>;
      // No dedicated inline slot for this one in the form — it surfaces as
      // a form-level error instead, right next to the checkbox it's about.
      if (key === "termsAccepted") {
        formError = issue.message;
        continue;
      }
      errors[key] = issue.message;
    }
    return { status: "error", errors, formError };
  }

  const { firstName, lastName, email, password, role } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return { status: "error", formError: "An account with this email already exists." };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const roleRow = await prisma.role.upsert({
    where: { key: role as GlobalRole },
    update: {},
    create: { key: role as GlobalRole, name: role },
  });

  // Created PENDING, not ACTIVE — the account cannot sign in until the
  // email address is confirmed. See issueEmailVerification below.
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      firstName,
      lastName,
      passwordHash,
      status: "PENDING",
      roles: { create: { roleId: roleRow.id } },
      ...(role === "TRAINER" ? { trainerProfile: { create: {} } } : {}),
      consentRecords: {
        create: [
          { type: "terms_of_service", version: "v1" },
          // Trainers are independent contractors, not employees — that
          // consent is distinct from the general platform terms and is
          // recorded separately so it's independently auditable.
          ...(role === "TRAINER" ? [{ type: "independent_contractor_agreement", version: "v1" }] : []),
        ],
      },
    },
  });

  const { url, delivered } = await issueEmailVerification(user.id, user.email, user.firstName);

  return {
    status: "success",
    ...(url ? { verificationUrl: url } : {}),
    ...(!delivered && !url ? { emailSendFailed: true } : {}),
  };
}
