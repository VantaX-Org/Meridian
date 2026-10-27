"use client";

import type { ObjectOwners } from "@/hooks/use-object-owners";

/**
 * An object's owner in a ledger cell: the name; "Not set" only when the owners list loaded and names nobody;
 * "Owner unavailable" when the list could not be read (never claim an object is unowned on a failed request);
 * a dash while it loads.
 */
export function OwnerName({ name, status }: { name: string | null | undefined; status: ObjectOwners["status"] }) {
  if (name) return <>{name}</>;
  if (status === "error") return <span className="m-ink-3" title="The list of owners could not be loaded">Owner unavailable</span>;
  if (status === "loading") return <span className="m-ink-3">—</span>;
  return <span className="m-ink-3">Not set</span>;
}
