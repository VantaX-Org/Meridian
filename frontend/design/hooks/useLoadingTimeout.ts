"use client";

import { useEffect, useState } from "react";

/** How long a page frame shows a skeleton before it gives up and offers Retry. */
export const LOADING_TIMEOUT_MS = 20_000;

/**
 * True once `loading` has been continuously true for `ms`. A frame uses it to swap a skeleton that
 * never resolves for an error state with Retry, instead of showing placeholders for ever. The flag
 * resets the moment `loading` turns false (state adjusted during render, so no extra effect).
 */
export function useLoadingTimeout(loading: boolean, ms = LOADING_TIMEOUT_MS): boolean {
  const [timedOut, setTimedOut] = useState(false);
  const [wasLoading, setWasLoading] = useState(loading);
  if (loading !== wasLoading) {
    setWasLoading(loading);
    if (!loading) setTimedOut(false);
  }
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => setTimedOut(true), ms);
    return () => window.clearTimeout(t);
  }, [loading, ms]);
  return loading && timedOut;
}
