"use client";

import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useAuroraPrefs } from "@/hooks/use-theme";
import type { Theme } from "@/lib/preferences";
import { PERSONA_LABEL, useOpenItem, useRunParam, useV2Session } from "@/lib/v2/hooks";
import { canAdminister } from "@/lib/v2/admin-sections";
import { useUnread } from "@/lib/v2/approvals-queries";
import { useLandscape } from "@/lib/v2/queries";
import { int, systemSlug } from "@/lib/v2/score";
import { productName, useTenantTheme } from "@/lib/v2/theme";
import { APP_VERSION } from "@/lib/version";
import { Dialog } from "../admin/kit";
import { IconDown, IconSearch, Mark } from "../marks";
import { MenuButton, type MenuEntry } from "../Menu";
import { RunTimelineMenu } from "../RunTimeline";
import { V2Link } from "../parts";
import { t as tr } from "@/lib/v2/i18n";

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

const STATE_SUB = { get analysed() { return tr("Analysed"); }, get extracted() { return tr("Extracted, not analysed"); }, get not_extracted() { return tr("Not extracted yet"); } } as const;

/** Which systems the canvas shows: all of them, or one. */
export function ScopeMenu({ compact }: { compact?: boolean }) {
  const run = useRunParam();
  const params = useSearchParams();
  const withParam = useWith();
  const systems = useLandscape(run).data?.systems ?? [];
  const chosen = params.get("system");
  const current = systems.find((s) => systemSlug(s.name) === chosen);
  const entries: MenuEntry[] = [
    { kind: "heading", label: tr("Scope") },
    { kind: "item", id: "all", label: tr("All systems"), sub: tr("{systemsCount} {systemsCount, plural, one {system} other {systems}}", { systemsCount: systems.length }), checked: !current, href: withParam("system", null) },
    ...systems.map<MenuEntry>((s) => ({ kind: "item", id: s.id, label: s.name, sub: STATE_SUB[s.state], checked: current?.id === s.id, href: withParam("system", systemSlug(s.name)) })),
  ];
  return (
    <MenuButton label={tr("Scope")} buttonLabel={tr("Scope, {name}", { name: current?.name ?? tr("All systems") })} entries={entries} className={compact ? "m2-btn m2-sm" : "m2-tbtn m2-scope"}>
      {current?.name ?? tr("All systems")}
      <IconDown />
    </MenuButton>
  );
}

/** Which run the numbers come from: the timeline of the last eight runs (design/v2/RunTimeline.tsx). */
export function RunMenu({ compact }: { compact?: boolean }) {
  return <RunTimelineMenu compact={compact} />;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", get label() { return tr("System"); } },
  { value: "light", get label() { return tr("Light"); } },
  { value: "dark", get label() { return tr("Dark"); } },
];

export interface AccountMenuProps {
  theme: Theme;
  setTheme: (t: Theme) => void;
  onShortcuts: () => void;
  onSignOut?: () => void;
}

/** About: the Meridian mark and version stay here whatever the tenant's own logo and name are. */
function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={tr("About Meridian")} onClose={onClose}>
      <p className="m2-about" data-testid="about-meridian">
        <Mark size={32} />
        <span>{tr("Meridian {APP_VERSION}", { APP_VERSION })}</span>
      </p>
      <p className="m2-prov">{tr("SAP data quality and master data management, deployed in your own environment. Your SAP data never leaves it.")}</p>
      <div className="m2-dlg-a">
        <button type="button" className="m2-btn" onClick={onClose}>
          {tr("Close")}
        </button>
      </div>
    </Dialog>
  );
}

/** Persona label and the account menu: who you are, theme, preferences, reports, shortcuts, administration, and the way back. */
export function AccountMenu({ theme, setTheme, onShortcuts, onSignOut }: AccountMenuProps) {
  const session = useV2Session();
  const { openItem, hrefFor } = useOpenItem();
  const [about, setAbout] = useState(false);
  const entries: MenuEntry[] = [
    { kind: "heading", label: session.name ? (session.email ? `${session.name}, ${session.email}` : session.name) : PERSONA_LABEL[session.persona] },
    { kind: "heading", label: tr("Theme") },
    ...THEMES.map<MenuEntry>((t) => ({ kind: "item", id: `theme-${t.value}`, label: t.label, checked: theme === t.value, onSelect: () => setTheme(t.value) })),
    { kind: "separator" },
    { kind: "item", id: "prefs", label: tr("Preferences"), href: hrefFor({ kind: "preferences", id: "" }) },
    { kind: "item", id: "reports", label: tr("Reports"), href: "/reports" },
    { kind: "item", id: "keys", label: tr("Keyboard shortcuts"), kbd: "?", onSelect: onShortcuts },
    { kind: "item", id: "triage", label: tr("Triage and SLA"), onSelect: () => openItem({ kind: "triage", id: "" }) },
    ...(canAdminister(session.can) ? [{ kind: "item", id: "admin", label: tr("Administration"), href: "/admin" } as MenuEntry] : []),
    { kind: "separator" },
    { kind: "item", id: "about", label: tr("About Meridian"), onSelect: () => setAbout(true) },
    ...(onSignOut ? [{ kind: "item", id: "out", label: tr("Sign out"), onSelect: onSignOut } as MenuEntry] : []),
  ];
  return (
    <>
      <MenuButton label={tr("Account")} buttonLabel={tr("Account, {label}", { label: session.label })} entries={entries} className="m2-tbtn m2-persona" align="end">
        <span>{session.label}</span>
        <IconDown />
      </MenuButton>
      {about ? <AboutDialog onClose={() => setAbout(false)} /> : null}
    </>
  );
}

function LiveAccountMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const { theme, setTheme } = useAuroraPrefs();
  const { logout } = useAuth();
  return <AccountMenu theme={theme} setTheme={setTheme} onShortcuts={onShortcuts} onSignOut={logout} />;
}

function FixtureAccountMenu({ onShortcuts }: { onShortcuts: () => void }) {
  // Fixture mode has no sign-in, but the theme is the same preference the live menu keeps (local first).
  const { theme, setTheme } = useAuroraPrefs();
  return <AccountMenu theme={theme} setTheme={setTheme} onShortcuts={onShortcuts} />;
}

export interface TopBarProps {
  onOpenCommand: () => void;
  onToggleMap: () => void;
  onShortcuts: () => void;
  mapOpen: boolean;
}

export function TopBar({ onOpenCommand, onToggleMap, onShortcuts, mapOpen }: TopBarProps) {
  const session = useV2Session();
  const unread = useUnread().data;
  const { open, openItem, close } = useOpenItem();
  const inbox = useMemo(() => (unread ? int(unread.count) : "—"), [unread]);
  const inboxOpen = open?.kind === "inbox";
  const helpOpen = open?.kind === "help";
  const askOpen = open?.kind === "ask";
  const tenant = useTenantTheme();
  const name = productName(tenant);
  return (
    <header className="m2-top">
      <div className="m2-top-l">
        <V2Link href="/" className="m2-brand" aria-label={tr("{name}, go to the landscape", { name })}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the tenant's logo, served by the API or, in fixture mode, from memory; next/image would add nothing */}
          {tenant?.logo_url ? <img src={tenant.logo_url} alt="" className="m2-logo" /> : <Mark />}
          <span className="m2-bn">{name}</span>
        </V2Link>
        <button type="button" className="m2-tbtn m2-mapbtn" aria-haspopup="dialog" aria-controls="m2-map" aria-expanded={mapOpen} onClick={onToggleMap}>
          {tr("Map")}
        </button>
        <ScopeMenu />
        <RunMenu />
      </div>
      <button type="button" className="m2-search" aria-haspopup="dialog" aria-label={tr("Search, ask, or type a command")} onClick={onOpenCommand}>
        <IconSearch />
        <span className="m2-search-ph">{tr("Search, ask, or type a command")}</span>
        <span className="m2-kb" aria-hidden="true">{"⌘"}K</span>
      </button>
      <div className="m2-top-r">
        <button type="button" className="m2-tbtn" aria-haspopup="dialog" aria-expanded={askOpen} onClick={() => (askOpen ? close() : openItem({ kind: "ask", id: "" }))}>
          {tr("Ask Meridian")}
        </button>
        <button type="button" className="m2-tbtn" aria-haspopup="dialog" aria-expanded={inboxOpen} aria-label={tr("Inbox {inbox}, unread", { inbox })} onClick={() => (inboxOpen ? close() : openItem({ kind: "inbox", id: "" }))}>
          {tr("Inbox")}{" "}<b>{inbox}</b>
        </button>
        <button type="button" className="m2-tbtn m2-help" aria-label={tr("Help")} aria-haspopup="dialog" aria-expanded={helpOpen} onClick={() => (helpOpen ? close() : openItem({ kind: "help", id: "" }))}>
          ?
        </button>
        {session.fixture ? <FixtureAccountMenu onShortcuts={onShortcuts} /> : <LiveAccountMenu onShortcuts={onShortcuts} />}
      </div>
    </header>
  );
}
