"use server";

import { z } from "zod";

import { headers } from "next/headers";

import { sendEmail } from "@/lib/email/client";
import { brand } from "@/config/brand";
import { checkRateLimit, clientIpFrom } from "@/lib/security/rate-limit";

const contactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  workEmail: z.string().email("Enter a valid work email"),
  company: z.string().min(1, "Company is required"),
  useCase: z.string().min(10, "Tell us a bit more about your use case"),
});

export type ContactState = {
  status: "idle" | "success" | "error";
  errors?: Partial<Record<keyof z.infer<typeof contactSchema>, string>>;
};

export async function submitContactForm(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    workEmail: formData.get("workEmail"),
    company: formData.get("company"),
    useCase: formData.get("useCase"),
  });

  if (!parsed.success) {
    const errors: ContactState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof z.infer<typeof contactSchema>;
      errors[key] = issue.message;
    }
    return { status: "error", errors };
  }

  // The form relays straight to the sales inbox — cap what one IP can send
  // so a bot can't turn it into a spam cannon. Reported as success: a
  // spammer learns nothing, and a rare legitimate fifth message within the
  // hour still reaches nobody worse than a full inbox would.
  const throttle = await checkRateLimit({
    bucket: "contact",
    id: clientIpFrom(await headers()),
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!throttle.ok) return { status: "success" };

  await sendEmail({
    to: brand.salesEmail,
    subject: `New demo request from ${parsed.data.company}`,
    html: `<p><strong>${parsed.data.name}</strong> (${parsed.data.workEmail}) at ${parsed.data.company} requested a demo.</p><p>${parsed.data.useCase}</p>`,
  });

  return { status: "success" };
}
