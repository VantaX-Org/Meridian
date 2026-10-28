"use client";

import { useQuery } from "@tanstack/react-query";
import { ATTENTION_POLL_MS, getAttention, getAttentionCount, type AttentionQuery } from "@/lib/api/attention";
import { queryKeys } from "@/lib/query-keys";

/** The viewer's counts and top item: the Rail badge and the home verdict button. Polled like the shell counts. */
export function useAttentionCount() {
  return useQuery({
    queryKey: queryKeys.attentionCount(),
    queryFn: getAttentionCount,
    refetchInterval: ATTENTION_POLL_MS,
    // A missing surface is not an error on the page that hosts it.
    meta: { ignoreError: true },
  });
}

/** The viewer's ranked to-do list, optionally narrowed to an object, a system or some kinds. */
export function useAttention(query: AttentionQuery = {}) {
  return useQuery({
    queryKey: queryKeys.attention({ ...query }),
    queryFn: () => getAttention(query),
    refetchInterval: ATTENTION_POLL_MS,
    meta: { ignoreError: true },
  });
}
