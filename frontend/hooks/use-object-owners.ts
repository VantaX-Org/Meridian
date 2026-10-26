"use client";

import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/context/auth-context";
import { getOwners, type DataOwner } from "@/lib/api/owners";
import { queryKeys } from "@/lib/query-keys";

export interface ObjectOwners {
  /** The owner row of an object (by module id); undefined when nobody owns it. */
  ownerOf: (module: string) => DataOwner | undefined;
  /** The owner's name, or null when the object has none. */
  nameOf: (module: string) => string | null;
  /** The object is owned by the signed-in user. */
  isMine: (module: string) => boolean;
  /** The signed-in user owns at least one object. */
  hasMine: boolean;
}

/** `?mine=1`: a list keeps only the signed-in user's objects. */
export const MINE_PARAM = "mine";

/**
 * Who owns each object: the tenant's `data_owners` rows of kind "object" (GET /api/v1/owners?kind=object, the list
 * the object header's OwnerPicker reads and writes, under the same cache key), and which of them the signed-in
 * user owns. Read-only and never blocking: a failed read leaves every object unowned.
 */
export function useObjectOwners(): ObjectOwners {
  const me = useCurrentUser();
  const q = useQuery({ queryKey: queryKeys.owners("object"), queryFn: () => getOwners("object"), retry: false, meta: { ignoreError: true } });
  const rows = q.data ?? [];
  const byModule = new Map(rows.map((o) => [o.ref, o]));
  return {
    ownerOf: (module) => byModule.get(module),
    nameOf: (module) => byModule.get(module)?.owner_name ?? null,
    isMine: (module) => !!me && byModule.get(module)?.owner_user_id === me.id,
    hasMine: !!me && rows.some((o) => o.owner_user_id === me.id),
  };
}
