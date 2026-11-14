import type { User } from "@/types/api";

/** True when this person is the only active administrator, so deactivating or removing them would lock everyone out. */
export function isLastAdmin(user: Pick<User, "id" | "role" | "is_active">, all: readonly Pick<User, "id" | "role" | "is_active">[]): boolean {
  if (user.role !== "admin" || !user.is_active) return false;
  return !all.some((u) => u.id !== user.id && u.role === "admin" && u.is_active);
}

/** Why this person cannot be deactivated or removed, or null when they can. Yourself and the last administrator are blocked. */
export function removeBlock(user: Pick<User, "id" | "role" | "is_active">, all: readonly Pick<User, "id" | "role" | "is_active">[], selfId: string | undefined): "self" | "last-admin" | null {
  if (user.id === selfId) return "self";
  return isLastAdmin(user, all) ? "last-admin" : null;
}
