"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPreferences, patchPreferences } from "@/lib/api/preferences";
import { queryKeys } from "@/lib/query-keys";
import {
  abandonPreferencesLoad,
  beginPreferencesLoad,
  composePatch,
  hydratePreferences,
  removeMigratedLegacyViews,
  syncPreferencesUser,
  readPrefs,
  registerPreferencesSink,
  setPreferences,
  subscribePreferences,
  type Preferences,
  type PreferencesPatch,
} from "@/lib/preferences";

const SERVER_SNAPSHOT: Preferences = {};

/**
 * The user's preferences. Reads come from the localStorage write-through copy, so the first paint is right with
 * no network; `update` writes locally at once and (while `usePreferencesSync` is mounted) to the server.
 */
export function usePreferences(): { prefs: Preferences; update: (patch: PreferencesPatch) => void } {
  const prefs = useSyncExternalStore(subscribePreferences, readPrefs, () => SERVER_SNAPSHOT);
  const update = useCallback((patch: PreferencesPatch) => setPreferences(patch), []);
  return { prefs, update };
}

/**
 * Mount once in the signed-in shell. Loads the server copy once (React Query), reconciles it into the local copy
 * (server wins; an empty server adopts this browser's choices) and forwards every later change to the server, in
 * order. A failed save leaves the local value in place and is silent: the next change then resends the whole local document.
 */
export function usePreferencesSync(userId?: string): void {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: queryKeys.preferences(userId),
    queryFn: getPreferences,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // The ordered send chain; the hydrate effect below queues its migration upload through the same one.
  const sendRef = useRef<((patch: PreferencesPatch, onSaved?: () => void) => void) | null>(null);
  useEffect(() => {
    let chain: Promise<unknown> = Promise.resolve();
    // After a failed save the server may be behind in ways no single patch describes, so the next save carries
    // the whole local document (with its own patch composed over it, so explicit removals still go through).
    let resendAll = false;
    const send = (patch: PreferencesPatch, onSaved?: () => void) => {
      chain = chain
        .then(async () => {
          const body = resendAll ? composePatch(readPrefs() as PreferencesPatch, patch) : patch;
          const doc = await patchPreferences(body);
          resendAll = false;
          qc.setQueryData(queryKeys.preferences(userId), doc);
          onSaved?.();
        })
        .catch(() => {
          resendAll = true;
        });
    };
    sendRef.current = send;
    registerPreferencesSink(send);
    return () => {
      sendRef.current = null;
      registerPreferencesSink(null);
    };
  }, [qc, userId]);

  // A new user (or a first mount): drop another user's cached choices, then queue local changes until the
  // server copy arrives.
  const hydrated = useRef(false);
  useEffect(() => {
    if (userId) syncPreferencesUser(userId);
    hydrated.current = false;
    beginPreferencesLoad();
  }, [userId]);
  useEffect(() => {
    if (q.isError) abandonPreferencesLoad();
  }, [q.isError]);

  useEffect(() => {
    // isFetchedAfterMount: never hydrate from a copy cached by a previous user of this browser tab.
    if (hydrated.current || !q.isFetchedAfterMount || !q.data) return;
    hydrated.current = true;
    const upload = hydratePreferences(q.data);
    if (upload) sendRef.current?.(upload, removeMigratedLegacyViews);
  }, [q.data, q.isFetchedAfterMount]);
}
