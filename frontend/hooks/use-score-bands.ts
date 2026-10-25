"use client";

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_SCORE_BANDS, type ScoreBands } from "@/design/primitives/ScoreRing";
import { getObjects } from "@/lib/api/v1/objects";
import { queryKeys } from "@/lib/query-keys";

/**
 * The tenant's score bands (target, warning, critical), as the objects list returns them. Same request and cache
 * entry as the homes and the current overview, so it costs no second call. Falls back to the default bands while
 * loading or when the API sends none.
 */
export function useScoreBands(): { bands: ScoreBands; loaded: boolean } {
  const q = useQuery({ queryKey: queryKeys.objects("latest"), queryFn: () => getObjects("latest") });
  return { bands: q.data?.thresholds ?? DEFAULT_SCORE_BANDS, loaded: q.isSuccess };
}
