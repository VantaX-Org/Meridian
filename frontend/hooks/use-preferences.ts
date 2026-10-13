"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPreferences, patchPreferences } from "@/lib/api/preferences";
import { queryKeys } from "@/lib/query-keys";
import {
  abandonPreferencesLoad,
  beginPreferencesLoad,
  hydratePreferences,
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
 * order. A failed save leaves the local value in place and is silent: the next change retries with its own patch.
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

  useEffect(() => {
    let chain: Promise<unknown> = Promise.resolve();
    const send = (patch: PreferencesPatch) => {
      chain = chain
        .then(() => patchPreferences(patch))
        .then((doc) => qc.setQueryData(queryKeys.preferences(userId), doc))
        .catch(() => undefined);
    };
    registerPreferencesSink(send);
    return () => registerPreferencesSink(null);
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
    if (upload) void patchPreferences(upload).catch(() => undefined);
  }, [q.data, q.isFetchedAfterMount]);
}
