"use client";

import { useQuery } from "@tanstack/react-query";
import { getLicenceManifest } from "@/lib/api/licence";
import { queryKeys } from "@/lib/query-keys";
import type { SeatCount } from "@/lib/users";

/** Seats in use and the licence limit (GET /licence); null until known, or when the licence reports no count. */
export function useSeats(enabled = true): SeatCount | null {
  const q = useQuery({ queryKey: queryKeys.licenceManifest(), queryFn: getLicenceManifest, enabled });
  const used = q.data?.seats_used;
  if (typeof used !== "number") return null;
  const limit = q.data?.seats;
  return { used, limit: typeof limit === "number" && limit > 0 ? limit : null };
}
