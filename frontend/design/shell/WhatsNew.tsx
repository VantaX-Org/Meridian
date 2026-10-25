"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { Drawer } from "../primitives/Drawer";
import { Pill } from "../primitives/Pill";
import { readSeenVersion, subscribeStorage, writeSeenVersion } from "@/lib/help/storage";
import { formatDate } from "@/lib/format";
import { APP_VERSION } from "@/lib/version";
import releaseNotes from "../../whats-new.json";

export interface ReleaseItem {
  title: string;
  body: string;
  href?: string;
}

export interface Release {
  version: string;
  date: string;
  items: ReleaseItem[];
}

export const RELEASES: readonly Release[] = releaseNotes;

/**
 * Whether the newest release has been seen. The seen version is stored by
 * `lib/help/storage.ts` (localStorage until lane 4 moves it to preferences).
 * Starts as "not new" until storage is read, so the first paint has no dot
 * that then disappears.
 */
export function useWhatsNew(releases: readonly Release[] = RELEASES): { hasNew: boolean; markSeen: () => void } {
  const latest = releases[0]?.version;
  // undefined on the server and during hydration, so the first paint never shows a dot that then goes away.
  const seen = useSyncExternalStore<string | null | undefined>(subscribeStorage, readSeenVersion, () => undefined);
  const markSeen = useCallback(() => {
    if (latest) writeSeenVersion(latest);
  }, [latest]);
  return { hasNew: seen !== undefined && latest !== undefined && seen !== latest, markSeen };
}

/** Drawer listing the releases, newest first. */
export function WhatsNew({
  open, onOpenChange, releases = RELEASES, currentVersion = APP_VERSION,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  releases?: readonly Release[];
  currentVersion?: string;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="What's new" subtitle={`You are on version ${currentVersion}`}>
      {releases.length === 0 ? (
        <p className="m-text-body m-ink-3">No release notes yet</p>
      ) : (
        <div className="flex flex-col gap-6" data-testid="whats-new">
          {releases.map((r) => (
            <section key={r.version} aria-labelledby={`release-${r.version}`}>
              <div className="mb-2 flex items-center gap-2">
                <h3 id={`release-${r.version}`} className="m-text-h font-semibold m-ink">Version {r.version}</h3>
                {r.version === currentVersion && <Pill tone="info">Current</Pill>}
                <span className="m-text-meta m-ink-3">{formatDate(r.date, "date")}</span>
              </div>
              <ul className="flex flex-col gap-3">
                {r.items.map((item) => (
                  <li key={item.title} className="m-text-body">
                    <p className="font-medium m-ink">
                      {item.href ? <Link href={item.href} onClick={() => onOpenChange(false)} className="m-ink-accent-ink">{item.title}</Link> : item.title}
                    </p>
                    <p className="m-ink-2">{item.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Drawer>
  );
}
