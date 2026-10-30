"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/context/auth-context";
import { usePreferencesSync } from "@/hooks/use-preferences";
import { PermissionsProvider } from "@/lib/permissions";
import { useFixture } from "@/lib/api/v2/fixture";
import { createDispatcher, gridRegistry, ledgerRegistry, type GoDestination, type KeyContext } from "@/lib/v2/keys";
import { useOpenItem, usePhone, useV2Href } from "@/lib/v2/hooks";
import { setUiCookie, UI_V2 } from "@/lib/v2/switch";
import { useApplyKeyHints } from "@/lib/v2/prefs";
import { readPrefs, subscribePreferences } from "@/lib/preferences";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { themeRootProps, useTenantTheme } from "@/lib/v2/theme";
import { CommandLine } from "../CommandLine";
import { Inspector } from "../Inspector";
import { ShortcutSheet } from "../ShortcutSheet";
import { FixtureJobLine, LiveJobLine } from "./JobLine";
import { AdminMap } from "../admin/Admin";
import { MapPane } from "./MapPane";
import { RoleBanners } from "./RoleBanners";
import { StatusStrip } from "./StatusStrip";
import { ToastProvider, useToast } from "../Toast";
import { TopBar } from "./TopBar";
import { useDocumentLang } from "./Standalone";

export { usePhone };

const DESTINATION: Record<GoDestination, string> = { landscape: "/v2", work: "/v2/work", runs: "/v2/runs", people: "/v2/people" };

function ChromeBody({ children }: { children: ReactNode }) {
  const fixture = useFixture();
  const router = useRouter();
  const pathname = usePathname();
  const href = useV2Href();
  const phone = usePhone();
  const { open, close } = useOpenItem();
  const [commandOpen, setCommandOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const toast = useToast();
  useApplyKeyHints();
  // Numbers and dates are written at render, so a change of locale redraws everything but the inspector that changed it.
  const localeKey = useSyncExternalStore(subscribePreferences, () => readPrefs().locale ?? "", () => "");

  // The cookie that says "this browser prefers the new interface" is set by arriving here.
  useEffect(() => setUiCookie(UI_V2), []);
  // The map sheet closes when you go somewhere.
  useEffect(() => setMapOpen(false), [pathname]);

  // The help panel's "Keyboard shortcuts" button asks for the sheet.
  useEffect(() => {
    const show = () => setSheetOpen(true);
    window.addEventListener("m2:shortcuts", show);
    return () => window.removeEventListener("m2:shortcuts", show);
  }, []);

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
        if (ledgerRegistry.get()?.step(dir)) return;
        const g = gridRegistry.get();
        g?.move(dir, false);
        g?.open();
      },
      undoLast: () => void toast.undoLast(),
      get ledger() {
        return ledgerRegistry.get();
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
    <>
      <nav className="m2-skips" aria-label={t("Skip links")}>
        <a className="m2-skip" href="#m2-canvas">
          {t("Skip to content")}
        </a>
        {phone ? null : (
          <a className="m2-skip" href="#m2-map">
            {t("Skip to the map")}
          </a>
        )}
        {open ? (
          <a className="m2-skip" href="#m2-inspector">
            {t("Skip to the inspector")}
          </a>
        ) : null}
      </nav>
      <TopBar key={localeKey} onOpenCommand={() => setCommandOpen(true)} onToggleMap={toggleMap} onShortcuts={() => setSheetOpen(true)} mapOpen={mapOpen} />
      {fixture ? <FixtureJobLine /> : <LiveJobLine />}
      <RoleBanners />
      <div className="m2-main">
        {pathname.startsWith("/v2/admin") ? <AdminMap key={localeKey} open={mapOpen} onClose={() => setMapOpen(false)} phone={phone} /> : <MapPane key={localeKey} open={mapOpen} onClose={() => setMapOpen(false)} phone={phone} />}
        {phone && mapOpen ? <div className="m2-scrim" onClick={() => setMapOpen(false)} aria-hidden="true" /> : null}
        <div className="m2-sheetwrap">
          <div className="m2-cwrap">
            <main key={localeKey} id="m2-canvas" className="m2-canvas" tabIndex={-1}>
              {children}
            </main>
            <StatusStrip />
          </div>
          <Inspector key={open?.kind === "preferences" ? "preferences" : localeKey} />
        </div>
      </div>
      {commandOpen ? <CommandLine onClose={() => setCommandOpen(false)} /> : null}
      {sheetOpen ? <ShortcutSheet onClose={() => setSheetOpen(false)} /> : null}
    </>
  );
}

/** The root of the v2 interface: its tokens are scoped to it, so the change notices live inside it too. */
function Chrome({ children, fixture }: { children: ReactNode; fixture: boolean }) {
  // The language is set here, above everything that writes words; the tenant's accent rides on the same root.
  const { tag } = useInterfaceLang();
  const theme = useTenantTheme();
  useDocumentLang(tag);
  return (
    <div className="m2-root" data-m2="" data-fixture={fixture ? "1" : undefined} lang={tag} {...themeRootProps(theme)}>
      <ToastProvider>
        <ChromeBody>{children}</ChromeBody>
      </ToastProvider>
    </div>
  );
}

/** Keeps this person's preferences (theme, density, locale) in step with the server while they are signed in. */
function PreferencesSync() {
  const { user } = useAuth();
  usePreferencesSync(user?.id);
  return null;
}

/**
 * The v2 shell: top bar, map, canvas, inspector, job line and status strip. In fixture mode (`?fixture=1`) it renders
 * with no session; otherwise it sits behind the same sign-in and permissions as the rest of the app.
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
      <PermissionsProvider>
        <PreferencesSync />
        {inner}
      </PermissionsProvider>
    </AuthGuard>
  );
}
