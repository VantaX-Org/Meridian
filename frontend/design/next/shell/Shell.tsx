"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/design/v2/auth/Guard";
import { useAuth } from "@/context/auth-context";
import { usePreferences, usePreferencesSync } from "@/hooks/use-preferences";
import { PermissionsProvider } from "@/lib/permissions";
import { RequestAccessHost } from "@/design/v2/RequestAccess";
import { Inspector } from "@/design/v2/Inspector";
import { useFixture } from "@/lib/api/v2/fixture";
import { isTyping } from "@/lib/v2/keys";
import { useOpenItem, useV2Href, useV2Session } from "@/lib/v2/hooks";
import { resolveDensity } from "@/lib/v2/density";
import { useAttentionCount } from "@/lib/v2/queries";
import { t } from "@/lib/v2/i18n";
import { PATHS, railOrder, type DestId } from "@/lib/next/nav-defaults";
import { Button } from "../kit";
import { NextPalette } from "../CommandPalette";
import { LegacyScope } from "./LegacyMount";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { BottomBar } from "./BottomBar";
import "./shell.css";

/** g then a letter goes to a place. Nothing here collides with a v2 key: the old `g` chords are not mounted in this shell. */
export const CHORDS: Record<string, string> = {
  p: PATHS.portfolio,
  o: PATHS.objects,
  w: PATHS.work,
  n: PATHS.monitor,
  l: PATHS.load,
  m: PATHS.more,
  r: "/more/rules",
  c: "/more/master-data",
  k: "/more/insights",
};
const CHORD_MS = 1200;

function KeysDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["⌘K", t("Search, ask, or type a command")],
    ["/", t("Focus the search")],
    ["?", t("Show this list")],
    ["g p", t("Go to Portfolio")],
    ["g o", t("Go to Objects")],
    ["g w", t("Go to Work")],
    ["g n", t("Go to Monitor")],
    ["g l", t("Go to Load")],
    ["g m", t("Go to More")],
    ["g r", t("Go to Rules")],
    ["g c", t("Go to Master data")],
    ["g k", t("Go to Insights")],
    ["F6", t("Move between the page, the panel and the menu")],
    [t("Esc"), t("Close the menu or the panel")],
  ];
  return (
    <div className="nx-scrim" role="presentation" onClick={onClose}>
      <div className="nx-dialog" role="dialog" aria-modal="true" aria-labelledby="nx-keys-t" data-testid="shortcut-sheet" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2 id="nx-keys-t" className="nx-dialog-title">{t("Keyboard shortcuts")}</h2>
        <dl className="nx-keys">
          {rows.map(([k, d]) => (
            <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{d}</dd></div>
          ))}
        </dl>
        <div className="nx-dialog-actions"><Button variant="primary" onClick={onClose} autoFocus>{t("Close")}</Button></div>
      </div>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const href = useV2Href();
  const { persona, can, name, label } = useV2Session();
  const { open, close } = useOpenItem();
  const { prefs } = usePreferences();
  const density = resolveDensity(prefs.density, persona);
  const attention = useAttentionCount().data;
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const order = useMemo<DestId[]>(() => railOrder(persona, can("export")), [persona, can]);
  const badge = attention ? attention.critical + attention.high : 0;

  // Keep the latest state for the one document listener.
  const live = useRef({ open, close, palette, sheet });
  useEffect(() => {
    live.current = { open, close, palette, sheet };
  });
  useEffect(() => {
    let chord = 0;
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = live.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (s.palette || s.sheet) return;
      if (e.key === "F6") {
        e.preventDefault();
        // page, then panel, then rail, then the page again
        const stops = [document.getElementById("nx-main"), s.open ? document.getElementById("m2-inspector") : null, document.querySelector<HTMLElement>("#nx-rail a")].filter(Boolean) as HTMLElement[];
        const at = stops.findIndex((el) => el.contains(document.activeElement));
        const next = stops[(at + (e.shiftKey ? stops.length - 1 : 1)) % stops.length];
        (next.matches("a,button,[tabindex]") ? next : (next.querySelector<HTMLElement>("a,button,input,[tabindex]") ?? next)).focus();
        return;
      }
      if (e.key === "Escape") {
        // An open menu closes itself and stops the event; what reaches here is the panel.
        if (s.open) {
          e.preventDefault();
          s.close();
        }
        return;
      }
      if (mod || e.altKey || isTyping(e.target)) return;
      if (chord) {
        const to = CHORDS[e.key.toLowerCase()];
        window.clearTimeout(chord);
        chord = 0;
        if (to) {
          e.preventDefault();
          router.push(href(to));
        }
        return;
      }
      if (e.key === "g") chord = window.setTimeout(() => (chord = 0), CHORD_MS);
      else if (e.key === "/") {
        e.preventDefault();
        document.getElementById("nx-search")?.focus();
      } else if (e.key === "?") {
        e.preventDefault();
        setSheet(true);
      }
    };
    document.addEventListener("keydown", on);
    return () => {
      document.removeEventListener("keydown", on);
      window.clearTimeout(chord);
    };
  }, [router, href]);

  useEffect(() => {
    const show = () => setSheet(true);
    window.addEventListener("m2:shortcuts", show);
    return () => window.removeEventListener("m2:shortcuts", show);
  }, []);

  return (
    <div className="nx-shell" data-density={density}>
      <nav className="nx-skips" aria-label={t("Skip links")}>
        <a className="nx-skip" href="#nx-main">{t("Skip to content")}</a>
        <a className="nx-skip" href="#nx-rail">{t("Skip to the menu")}</a>
      </nav>
      <Rail
        order={order}
        workBadge={badge}
        initial={(name || label).slice(0, 1).toUpperCase()}
        onHelp={() => setSheet(true)}
        onAccount={() => document.querySelector<HTMLElement>(".nx-account")?.click()}
      />
      <TopBar onOpenCommand={() => setPalette(true)} onShortcuts={() => setSheet(true)} />
      <main id="nx-main" className="nx-main" tabIndex={-1}>{children}</main>
      <BottomBar order={order} workBadge={badge} />
      {open ? (
        <div className="nx-insp-host">
          <LegacyScope><Inspector /></LegacyScope>
        </div>
      ) : null}
      <NextPalette open={palette} onClose={() => setPalette(false)} />
      {sheet ? <KeysDialog onClose={() => setSheet(false)} /> : null}
    </div>
  );
}

function PreferencesSync() {
  const { user } = useAuth();
  usePreferencesSync(user?.id);
  return null;
}

/** The next shell: rail, top bar, bottom bar under 1100 px, palette, one inspector host. Same sign-in and permissions as v2. */
export function Shell({ children }: { children: ReactNode }) {
  const fixture = useFixture();
  const inner = (
    <Suspense fallback={null}>
      <Frame>{children}</Frame>
    </Suspense>
  );
  if (fixture) return inner;
  return (
    <AuthGuard>
      <PermissionsProvider>
        <PreferencesSync />
        {inner}
        <RequestAccessHost />
      </PermissionsProvider>
    </AuthGuard>
  );
}
