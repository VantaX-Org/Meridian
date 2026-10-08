"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorState, HomePage, Skeleton } from "@/design";
import { getObjects } from "@/lib/api/v1/objects";
import { buildNarrative, type NarrativeInput } from "@/lib/home-narrative";
import { queryKeys } from "@/lib/query-keys";

/** Shared by the three persona pages (lead/steward/basis) — same fetch and
 * loading/error handling, only the role (and the resulting narrative) differs. */
export function PersonaHomePage({ role }: { role: NarrativeInput["role"] }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.objects("latest"),
    queryFn: () => getObjects("latest"),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="p-6">
        <ErrorState
          message={`Couldn't load your home page. ${error?.message ?? ""}`.trim()}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const narrative = buildNarrative({ role, objects: data.objects });
  return <HomePage persona={role} headline={narrative} tiles={[]} lists={null} />;
}
