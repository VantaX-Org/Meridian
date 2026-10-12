"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";

const DEBOUNCE_MS = 80;

function safeQueryClient(): QueryClient | null {
  // Component tests render without a provider; prefetching is then a no-op.
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQueryClient();
  } catch {
    return null;
  }
}

function safeRouter(): ReturnType<typeof useRouter> | null {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useRouter();
  } catch {
    return null;
  }
}

export interface PrefetchHandlers {
  onPointerEnter: () => void;
  onFocus: () => void;
  onPointerLeave: () => void;
  onBlur: () => void;
}

/** Warms the route (`router.prefetch`) and optionally a query on pointer enter or focus, debounced. */
export function usePrefetch<T = unknown>(
  href?: string,
  queryKey?: QueryKey,
  queryFn?: () => Promise<T>,
): PrefetchHandlers {
  const router = safeRouter();
  const queryClient = safeQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const fire = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (href && router) router.prefetch(href);
      if (queryClient && queryKey && queryFn) void queryClient.prefetchQuery({ queryKey, queryFn });
    }, DEBOUNCE_MS);
  }, [cancel, href, router, queryClient, queryKey, queryFn]);
  return { onPointerEnter: fire, onFocus: fire, onPointerLeave: cancel, onBlur: cancel };
}
