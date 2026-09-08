"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { GLOBAL_ROLES, isSuperAdmin, type GlobalRole } from "@/lib/permissions/roles";

export type ActionState = { status: "idle" | "success" | "error"; message?: string };

const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(GLOBAL_ROLES),
});

/**
 * Role delegation is Super Admin only — it is the mechanism by which every
 * other permission is granted, so it must not be delegable to the roles it
 * can create.
 */
async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  if (!isSuperAdmin(session.user.roles)) throw new Error("Only a Super Admin can change roles.");
  return session.user;
}

export async function grantRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let actor;
  try {
    actor = await requireSuperAdmin();
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  const parsed = roleSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return { status: "error", message: "Invalid role selection." };

  const role = await prisma.role.upsert({
    where: { key: parsed.data.role as GlobalRole },
    update: {},
    create: { key: parsed.data.role as GlobalRole, name: parsed.data.role.replace(/_/g, " ") },
  });

  const existing = await prisma.userRole.findUnique({
    where: { userId_roleId: { userId: parsed.data.userId, roleId: role.id } },
  });
  if (existing) return { status: "error", message: "User already has that role." };

  await prisma.$transaction([
    prisma.userRole.create({ data: { userId: parsed.data.userId, roleId: role.id } }),
    // Force existing JWT sessions to rehydrate their role set on the next
    // request. A role grant must take effect immediately, even in a browser
    // that was already signed in when the change was made.
    prisma.user.update({
      where: { id: parsed.data.userId },
      data: { sessionVersion: { increment: 1 } },
    }),
    prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "user.role_granted",
        entityType: "User",
        entityId: parsed.data.userId,
        metadata: { role: parsed.data.role },
      },
    }),
    prisma.notification.create({
      data: {
        userId: parsed.data.userId,
        type: "role_granted",
        title: "Your access was updated",
        body: `You've been granted the ${parsed.data.role.replace(/_/g, " ").toLowerCase()} role.`,
      },
    }),
  ]);

  revalidatePath("/admin/users");
  return { status: "success", message: "Role granted." };
}

export async function revokeRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let actor;
  try {
    actor = await requireSuperAdmin();
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  const parsed = roleSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return { status: "error", message: "Invalid role selection." };

  // Guard against removing the last Super Admin and locking everyone out.
  if (parsed.data.role === "SUPER_ADMIN") {
    const superAdminCount = await prisma.userRole.count({ where: { role: { key: "SUPER_ADMIN" } } });
    if (superAdminCount <= 1) {
      return { status: "error", message: "Cannot remove the last Super Admin." };
    }
  }

  const role = await prisma.role.findUnique({ where: { key: parsed.data.role as GlobalRole } });
  if (!role) return { status: "error", message: "Role not found." };

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: parsed.data.userId, roleId: role.id } }),
    // Existing JWTs carry the old role list. Bump the version so the next
    // server-side auth check rejects those tokens instead of preserving
    // access to the revoked surface until normal expiry.
    prisma.user.update({
      where: { id: parsed.data.userId },
      data: { sessionVersion: { increment: 1 } },
    }),
    prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "user.role_revoked",
        entityType: "User",
        entityId: parsed.data.userId,
        metadata: { role: parsed.data.role },
      },
    }),
  ]);

  revalidatePath("/admin/users");
  return { status: "success", message: "Role revoked." };
}

const statusSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]),
});

export async function setUserStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let actor;
  try {
    actor = await requireSuperAdmin();
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  const parsed = statusSchema.safeParse({
    userId: formData.get("userId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid status." };

  if (parsed.data.userId === actor.id) {
    return { status: "error", message: "You cannot change your own account status." };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: parsed.data.userId },
      data: { status: parsed.data.status, sessionVersion: { increment: 1 } },
    }),
    prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "user.status_changed",
        entityType: "User",
        entityId: parsed.data.userId,
        metadata: { status: parsed.data.status },
      },
    }),
  ]);

  revalidatePath("/admin/users");
  return { status: "success", message: `User ${parsed.data.status.toLowerCase()}.` };
}
