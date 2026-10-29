"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/context/auth-context";
import { useAuroraPrefs } from "@/hooks/use-theme";
import type { Theme } from "@/lib/preferences";
import { PERSONA_LABEL, useRunParam, useV2Session } from "@/lib/v2/hooks";
import { useCounts, useLandscape, useRunList } from "@/lib/v2/queries";
import { setUiCookie } from "@/lib/v2/switch";
import { int, systemSlug } from "@/lib/v2/score";
import { IconDown, IconSearch, Mark } from "../marks";
import { MenuButton, type MenuEntry } from "../Menu";
import { V2Link } from "../parts";

/** The current URL with one query parameter set or removed, for the scope and run menus. */
function useWith(): (name: string, value: string | null) => string {
  const pathname = usePathname();
  const params = useSearchParams();
  return (name, value) => {
    const next = new URLSearchParams(params.toString());
    next.delete("open");
    if (value) next.set(name, value);
    else next.delete(name);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
}

const STATE_SUB = { analysed: "Analysed", extracted: "Extracted, not analysed", not_extracted: "Not extracted yet" } as const;

/** Which systems the canvas shows: all of them, or one. */
export function ScopeMenu({ compact }: { compact?: boolean }) {
  const run = useRunParam();
  const params = useSearchParams();
  const withParam = useWith();
  const systems = useLandscape(run).data?.systems ?? [];
  const chosen = params.get("system");
  const current = systems.find((s) => systemSlug(s.name) === chosen);
  const entries: MenuEntry[] = [
    { kind: "heading", label: "Scope" },
    { kind: "item", id: "all", label: "All systems", sub: `${systems.length} ${systems.length === 1 ? "system" : "systems"}`, checked: !current, href: withParam("system", null) },
    ...systems.map<MenuEntry>((s) => ({ kind: "item", id: s.id, label: s.name, sub: STATE_SUB[s.state], checked: current?.id === s.id, href: withParam("system", systemSlug(s.name)) })),
  ];
  return (
    <MenuButton label="Scope" buttonLabel={`Scope, ${current?.name ?? "All systems"}`} entries={entries} className={compact ? "m2-btn m2-sm" : "m2-tbtn m2-scope"}>
      {current?.name ?? "All systems"}
      <IconDown />
    </MenuButton>
  );
}

/** Which run the numbers come from: the last eight, newest first. No choice means the current state. */
export function RunMenu({ compact }: { compact?: boolean }) {
  const run = useRunParam();
  const withParam = useWith();
  const runs = useRunList().data?.versions ?? [];
  const selected = runs.find((r) => r.id === run) ?? runs[0];
  const entries: MenuEntry[] = [
    { kind: "heading", label: "Runs" },
    ...runs.map<MenuEntry>((r, i) => ({
      kind: "item",
      id: r.id,
      label: formatDate(r.run_at, "datetime"),
      sub: i === 0 ? "Latest" : r.label ?? undefined,
      checked: selected?.id === r.id,
      href: withParam("run", i === 0 ? null : r.id),
    })),
  ];
  if (runs.length === 0) entries.push({ kind: "item", id: "none", label: "No run yet", disabled: true });
  return (
    <MenuButton label="Run" entries={entries} className={compact ? "m2-btn m2-sm" : "m2-tbtn m2-runsw"}>
      {selected ? `Run ${formatDate(selected.run_at, "datetime")}` : "No run yet"}
      <IconDown />
    </MenuButton>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export interface AccountMenuProps {
  theme: Theme;
  setTheme: (t: Theme) => void;
  onShortcuts: () => void;
  onSignOut?: () => void;
}

/** Persona label and the account menu: who you are, theme, shortcuts, administration, and the way back. */
export function AccountMenu({ theme, setTheme, onShortcuts, onSignOut }: AccountMenuProps) {
  const session = useV2Session();
  const entries: MenuEntry[] = [
    { kind: "heading", label: session.name ? (session.email ? `${session.name}, ${session.email}` : session.name) : PERSONA_LABEL[session.persona] },
    { kind: "heading", label: "Theme" },
    ...THEMES.map<MenuEntry>((t) => ({ kind: "item", id: `theme-${t.value}`, label: t.label, checked: theme === t.value, onSelect: () => setTheme(t.value) })),
    { kind: "separator" },
    { kind: "item", id: "keys", label: "Keyboard shortcuts", kbd: "?", onSelect: onShortcuts },
    ...(session.can("manage_settings") ? [{ kind: "item", id: "admin", label: "Administration", href: "/admin", external: true } as MenuEntry] : []),
    { kind: "separator" },
    { kind: "item", id: "back", label: "Back to the current interface", href: "/home", external: true, onSelect: () => setUiCookie(null) },
    ...(onSignOut ? [{ kind: "item", id: "out", label: "Sign out", onSelect: onSignOut } as MenuEntry] : []),
  ];
  return (
    <MenuButton label="Account" buttonLabel={`Account, ${session.label}`} entries={entries} className="m2-tbtn m2-persona" align="end">
      <span>{session.label}</span>
      <IconDown />
    </MenuButton>
  );
}

function LiveAccountMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const { theme, setTheme } = useAuroraPrefs();
  const { logout } = useAuth();
  return <AccountMenu theme={theme} setTheme={setTheme} onShortcuts={onShortcuts} onSignOut={logout} />;
}

function FixtureAccountMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => {
    if (theme === "system") return;
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <AccountMenu theme={theme} setTheme={setThemeState} onShortcuts={onShortcuts} />;
}

export interface TopBarProps {
  onOpenCommand: () => void;
  onToggleMap: () => void;
  onShortcuts: () => void;
  mapOpen: boolean;
}

export function TopBar({ onOpenCommand, onToggleMap, onShortcuts, mapOpen }: TopBarProps) {
  const session = useV2Session();
  const counts = useCounts().data;
  const inbox = useMemo(() => (counts ? int(counts.inbox) : "—"), [counts]);
  return (
    <header className="m2-top">
      <div className="m2-top-l">
        <V2Link href="/v2" className="m2-brand" aria-label="Meridian, go to the landscape">
          <Mark />
          <span className="m2-bn">Meridian</span>
        </V2Link>
        <button type="button" className="m2-tbtn m2-mapbtn" aria-haspopup="dialog" aria-controls="m2-map" aria-expanded={mapOpen} onClick={onToggleMap}>
          Map
        </button>
        <ScopeMenu />
        <RunMenu />
      </div>
      <button type="button" className="m2-search" aria-haspopup="dialog" aria-label="Search or type a command" onClick={onOpenCommand}>
        <IconSearch />
        <span className="m2-search-ph">Search or type a command</span>
        <span className="m2-kb" aria-hidden="true">{"⌘"}K</span>
      </button>
      <div className="m2-top-r">
        <V2Link href="/inbox" className="m2-tbtn" aria-label={`Inbox, ${inbox} waiting`}>
          Inbox <b>{inbox}</b>
        </V2Link>
        {session.fixture ? <FixtureAccountMenu onShortcuts={onShortcuts} /> : <LiveAccountMenu onShortcuts={onShortcuts} />}
      </div>
    </header>
  );
}
