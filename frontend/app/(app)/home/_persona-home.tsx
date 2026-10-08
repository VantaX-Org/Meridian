"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, HomePage, Skeleton } from "@/design";
import { getObjects } from "@/lib/api/v1/objects";
import { buildNarrative, type NarrativeInput } from "@/lib/home-narrative";

/** Shared by the three persona pages (lead/steward/basis) — same fetch and
 * loading/error handling, only the role (and the resulting narrative) differs. */
export function PersonaHomePage({ role }: { role: NarrativeInput["role"] }) {
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["objects", "latest"],
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
        <ErrorState message="Couldn't load your home page. Try again." onRetry={() => router.refresh()} />
      </div>
    );
  }

  const narrative = buildNarrative({ role, objects: data.objects });
  return <HomePage headline={narrative} tiles={[]} lists={null} />;
}
