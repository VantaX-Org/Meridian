"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { PermissionsProvider } from "@/lib/permissions";
import { useFixture } from "@/lib/api/v2/fixture";
import { createDispatcher, gridRegistry, type GoDestination, type KeyContext } from "@/lib/v2/keys";
import { useOpenItem, useV2Href } from "@/lib/v2/hooks";
import { setUiCookie, UI_V2 } from "@/lib/v2/switch";
import { CommandLine } from "../CommandLine";
import { Inspector } from "../Inspector";
import { ShortcutSheet } from "../ShortcutSheet";
import { FixtureJobLine, LiveJobLine } from "./JobLine";
import { MapPane } from "./MapPane";
import { StatusStrip } from "./StatusStrip";
import { TopBar } from "./TopBar";

const PHONE = "(max-width: 760px)";
const subscribePhone = (cb: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** True at phone width, where the map is a bottom sheet and the inspector fills the screen. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

const DESTINATION: Record<GoDestination, string> = { landscape: "/v2", work: "/v2/work", runs: "/v2/runs", people: "/v2/people" };

function Chrome({ children, fixture }: { children: ReactNode; fixture: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const href = useV2Href();
  const phone = usePhone();
  const { open, close } = useOpenItem();
  const [commandOpen, setCommandOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  // The cookie that says "this browser prefers the new interface" is set by arriving here.
  useEffect(() => setUiCookie(UI_V2), []);
  // The map sheet closes when you go somewhere.
  useEffect(() => setMapOpen(false), [pathname]);

  const ctx = useRef<KeyContext>({});
  useEffect(() => {
    ctx.current = {
      openCommand: () => setCommandOpen((v) => !v),
      openShortcuts: () => setSheetOpen(true),
      go: (d) => router.push(href(DESTINATION[d])),
      escape: () => {
        if (mapOpen && phone) {
          setMapOpen(false);
          return true;
        }
        if (open) {
          close();
          return true;
        }
        return false;
      },
      stepInspector: (dir) => {
        const g = gridRegistry.get();
        g?.move(dir, false);
        g?.open();
      },
      get grid() {
        const at = document.activeElement;
        return at === document.body || at === document.getElementById("m2-canvas") ? gridRegistry.get() : null;
      },
    };
  });
  const dispatcher = useMemo(() => createDispatcher(() => ctx.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((commandOpen || sheetOpen) && !(e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) return;
      dispatcher.handle(e);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dispatcher, commandOpen, sheetOpen]);

  const toggleMap = useCallback(() => setMapOpen((v) => !v), []);
  return (
    <div className="m2-root" data-m2="" data-fixture={fixture ? "1" : undefined}>
      <a className="m2-skip" href="#m2-canvas">
        Skip to content
      </a>
      <TopBar onOpenCommand={() => setCommandOpen(true)} onToggleMap={toggleMap} onShortcuts={() => setSheetOpen(true)} mapOpen={mapOpen} />
      {fixture ? <FixtureJobLine /> : <LiveJobLine />}
      <div className="m2-main">
        <MapPane open={mapOpen} onClose={() => setMapOpen(false)} phone={phone} />
        {phone && mapOpen ? <div className="m2-scrim" onClick={() => setMapOpen(false)} aria-hidden="true" /> : null}
        <div className="m2-sheetwrap">
          <div className="m2-cwrap">
            <main id="m2-canvas" className="m2-canvas" tabIndex={-1}>
              {children}
            </main>
            <StatusStrip />
          </div>
          <Inspector />
        </div>
      </div>
      {commandOpen ? <CommandLine onClose={() => setCommandOpen(false)} /> : null}
      {sheetOpen ? <ShortcutSheet onClose={() => setSheetOpen(false)} /> : null}
    </div>
  );
}

/**
 * The v2 shell: top bar, map, canvas, inspector, job line and status strip. In fixture mode (`?fixture=1`) it renders
 * with no session; otherwise it sits behind the same sign-in and permissions as the current interface.
 */
export function V2Shell({ children }: { children: ReactNode }) {
  const fixture = useFixture();
  const inner = (
    <Suspense fallback={null}>
      <Chrome fixture={fixture}>{children}</Chrome>
    </Suspense>
  );
  if (fixture) return inner;
  return (
    <AuthGuard>
      <PermissionsProvider>{inner}</PermissionsProvider>
    </AuthGuard>
  );
}
