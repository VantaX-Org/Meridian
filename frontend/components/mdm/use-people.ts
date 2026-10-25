"use client";

/**
 * The tenant's people, read through whichever list the viewer may open: the assignable list (`assign`) or the
 * admin user list (`manage_users`). Neither granted, the list is empty and every id reads as unresolved, so the
 * caller says "a user" rather than printing a raw id.
 */

import { useQuery } from "@tanstack/react-query";
import { useRole } from "@/hooks/use-role";
import { getAssignableUsers, getUsers } from "@/lib/api/users";
import { queryKeys } from "@/lib/query-keys";

export interface Person { id: string; name: string; email: string }

/** `selfId`, when given, reads as "you". */
export function usePeople(selfId?: string | null): { people: Person[]; nameOf: (id: string | null | undefined) => string | null } {
  const { can } = useRole();
  const viaAssign = can("assign");
  const viaAdmin = !viaAssign && can("manage_users");
  // Same key and shape the inbox uses for the assignable list, so the two share one cache entry.
  const assignable = useQuery({ queryKey: ["users", "assignable"], queryFn: getAssignableUsers, enabled: viaAssign, staleTime: 300_000, meta: { ignoreError: true } });
  const admin = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers, enabled: viaAdmin, staleTime: 300_000, meta: { ignoreError: true } });
  const people: Person[] = (viaAssign ? assignable.data : admin.data?.users) ?? [];
  const nameOf = (id: string | null | undefined): string | null => {
    if (!id) return null;
    if (selfId && selfId === id) return "you";
    const p = people.find((x) => x.id === id);
    return p ? p.name || p.email : null;
  };
  return { people, nameOf };
}
