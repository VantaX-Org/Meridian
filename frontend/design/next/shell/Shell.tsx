"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthGuard } from "@/design/v2/auth/Guard";
import { useAuth } from "@/context/auth-context";
import { usePreferences, usePreferencesSync } from "@/hooks/use-preferences";
import { PermissionsProvider } from "@/lib/permissions";
import { RequestAccessHost } from "@/design/v2/RequestAccess";
import { useFixture } from "@/lib/api/v2/fixture";
import { isTyping } from "@/lib/v2/keys";
import { useOpenItem, useV2Href, useV2Session } from "@/lib/v2/hooks";
import { resolveDensity } from "@/lib/v2/density";
import { useAttentionCount } from "@/lib/v2/queries";
import { t } from "@/lib/v2/i18n";
import { PATHS, railOrder, type DestId } from "@/lib/next/nav-defaults";
import { Button, InspectorColumn, Sheet } from "../kit";
import { NextPalette } from "../CommandPalette";
import { onObjectPage, openDownload, openUpload, stepRun } from "./events";
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
    ["i", t("Show or hide the details panel")],
    ["[ ]", t("Previous or next run, on an object")],
    ["u", t("Upload a file, on an object")],
    ["d", t("Download, on an object")],
    ["g p", t("Go to Portfolio")],
    ["g o", t("Go to Objects")],
    ["g w", t("Go to Work")],
    ["g n", t("Go to Monitor")],
    ["g l", t("Go to Load")],
    ["g m", t("Go to More")],
    ["g r", t("Go to Rules")],
    ["g c", t("Go to Master data")],
    ["g k", t("Go to Insights")],
    ["F6", t("Move between the menu, the page and the panel")],
    [t("Esc"), t("Close the menu or the panel")],
  ];
  return (
    <Sheet open onClose={onClose} title={t("Keyboard shortcuts")} testId="shortcut-sheet">
      <dl className="nx-keys">
        {rows.map(([k, d]) => (
          <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{d}</dd></div>
        ))}
      </dl>
      <div className="nx-dialog-actions"><Button variant="primary" onClick={onClose}>{t("Close")}</Button></div>
    </Sheet>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const href = useV2Href();
  const { persona, can, name, label } = useV2Session();
  const { open, close, openItem } = useOpenItem();
  const { prefs } = usePreferences();
  const density = resolveDensity(prefs.density, persona);
  const attention = useAttentionCount().data;
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const lastItem = useRef<{ kind: string; id: string } | null>(null);
  const order = useMemo<DestId[]>(() => railOrder(persona, can("export")), [persona, can]);
  const badge = attention ? attention.critical + attention.high : 0;

  // Keep the latest state for the one document listener.
  const live = useRef({ open, close, openItem, palette, sheet, pathname });
  useEffect(() => {
    live.current = { open, close, openItem, palette, sheet, pathname };
    if (open) lastItem.current = open;
  });
  // A page whose title has scrolled away sets data-collapsed on its title scope; the top bar then turns to glass.
  useEffect(() => {
    const main = document.getElementById("nx-main");
    if (!main) return;
    const read = () => setCollapsed(!!main.querySelector('[data-title-scope][data-collapsed="true"]'));
    read();
    const mo = new MutationObserver(read);
    mo.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-collapsed"] });
    return () => mo.disconnect();
  }, []);
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
        // sidebar, then content, then inspector, then the sidebar again
        const stops = [document.querySelector<HTMLElement>("#nx-rail a"), document.getElementById("nx-main"), s.open ? document.getElementById("nx-inspector") : null].filter(Boolean) as HTMLElement[];
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
      } else if (e.key === "i") {
        e.preventDefault();
        if (s.open) s.close();
        else s.openItem((lastItem.current ?? { kind: "inbox", id: "" }) as never);
      } else if (onObjectPage(s.pathname)) {
        if (e.key === "[" || e.key === "]") stepRun(e.key === "[" ? -1 : 1);
        else if (e.key === "u") openUpload();
        else if (e.key === "d") openDownload();
        else return;
        e.preventDefault();
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
      <TopBar collapsed={collapsed} onObjectPage={onObjectPage(pathname)} onOpenCommand={() => setPalette(true)} onShortcuts={() => setSheet(true)} />
      <main id="nx-main" className="nx-main" data-title-scope="" tabIndex={-1}>{children}</main>
      <BottomBar order={order} workBadge={badge} />
      <InspectorColumn />
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
