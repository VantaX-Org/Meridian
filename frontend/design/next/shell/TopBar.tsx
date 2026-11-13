"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useAuroraPrefs } from "@/hooks/use-theme";
import type { Theme } from "@/lib/preferences";
import { PERSONA_LABEL, useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { canAdminister } from "@/lib/v2/admin-sections";
import { useUnread } from "@/lib/v2/approvals-queries";
import { productName, useTenantTheme } from "@/lib/v2/theme";
import { APP_VERSION } from "@/lib/version";
import { t } from "@/lib/v2/i18n";
import { MenuButton, type MenuEntry } from "@/design/v2/Menu";
import { Icon } from "../Icon";
import { Button } from "../kit";
import { LABEL, destAt } from "./dest";
import { openDownload, openUpload } from "./events";

/** Where you are: the destination, then the part of it. */
function Crumb() {
  const pathname = usePathname();
  const here = destAt(pathname);
  if (!here) return null;
  const rest = pathname.split("/").filter(Boolean).slice(here === "work" ? 2 : 1);
  return (
    <nav className="nx-crumb" aria-label={t("Breadcrumb")}>
      <span aria-current={rest.length ? undefined : "page"}>{LABEL[here]()}</span>
      {rest.map((p, i) => (
        <span key={p} style={{ display: "contents" }}>
          <span className="nx-crumb-sep" aria-hidden="true">/</span>
          <span aria-current={i === rest.length - 1 ? "page" : undefined}>{decodeURIComponent(p)}</span>
        </span>
      ))}
    </nav>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="nx-scrim" role="presentation" onClick={onClose}>
      <div className="nx-dialog" role="dialog" aria-modal="true" aria-labelledby="nx-about-t" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2 id="nx-about-t" className="nx-dialog-title">{t("About Meridian")}</h2>
        <p>{t("Meridian {APP_VERSION}", { APP_VERSION })}</p>
        <p className="nx-dialog-body">{t("SAP data quality and master data management, deployed in your own environment. Your SAP data never leaves it.")}</p>
        <div className="nx-dialog-actions"><Button variant="primary" onClick={onClose} autoFocus>{t("Close")}</Button></div>
      </div>
    </div>
  );
}

export interface AccountProps { theme: Theme; setTheme: (t: Theme) => void; onShortcuts: () => void; onSignOut?: () => void }

/** The account menu of the old shell, less Reports (it is under More now) and with Administration at /more/admin. */
export function NextAccountMenu({ theme, setTheme, onShortcuts, onSignOut }: AccountProps) {
  const session = useV2Session();
  const { openItem, hrefFor } = useOpenItem();
  const [about, setAbout] = useState(false);
  const entries: MenuEntry[] = [
    { kind: "heading", label: session.name ? (session.email ? `${session.name}, ${session.email}` : session.name) : PERSONA_LABEL[session.persona] },
    { kind: "heading", label: t("Theme") },
    { kind: "item", id: "theme-light", label: t("Light"), checked: theme === "light", onSelect: () => setTheme("light") },
    { kind: "item", id: "theme-dark", label: t("Dark"), checked: theme === "dark", onSelect: () => setTheme("dark") },
    { kind: "separator" },
    { kind: "item", id: "prefs", label: t("Preferences"), href: hrefFor({ kind: "preferences", id: "" }) },
    { kind: "item", id: "keys", label: t("Keyboard shortcuts"), kbd: "?", onSelect: onShortcuts },
    { kind: "item", id: "triage", label: t("Triage and SLA"), onSelect: () => openItem({ kind: "triage", id: "" }) },
    ...(canAdminister(session.can) ? [{ kind: "item", id: "admin", label: t("Administration"), href: "/more/admin" } as MenuEntry] : []),
    { kind: "separator" },
    { kind: "item", id: "about", label: t("About Meridian"), onSelect: () => setAbout(true) },
    ...(onSignOut ? [{ kind: "item", id: "out", label: t("Sign out"), onSelect: onSignOut } as MenuEntry] : []),
  ];
  return (
    <>
      <MenuButton label={t("Account")} buttonLabel={t("Account, {label}", { label: session.label })} entries={entries} className="nx-tbtn nx-account" align="end">
        <span>{session.label}</span>
        <Icon name="chevron-down" size={16} />
      </MenuButton>
      {about ? <AboutDialog onClose={() => setAbout(false)} /> : null}
    </>
  );
}

function Account({ onShortcuts }: { onShortcuts: () => void }) {
  const { theme, setTheme } = useAuroraPrefs();
  const { logout } = useAuth();
  const session = useV2Session();
  return <NextAccountMenu theme={theme} setTheme={setTheme} onShortcuts={onShortcuts} onSignOut={session.fixture ? undefined : logout} />;
}

export interface TopBarProps { onOpenCommand: () => void; onShortcuts: () => void; collapsed?: boolean; onObjectPage?: boolean }

export function TopBar({ onOpenCommand, onShortcuts, collapsed, onObjectPage }: TopBarProps) {
  const unread = useUnread().data;
  const { open, openItem, close } = useOpenItem();
  const { theme, setTheme } = useAuroraPrefs();
  const name = productName(useTenantTheme());
  const inbox = unread ? String(unread.count) : "—";
  const toggle = (kind: string) => (open?.kind === kind ? close() : openItem({ kind, id: "" } as never));
  return (
    <header className={collapsed ? "nx-top nx-glass" : "nx-top"} data-collapsed={collapsed ? "true" : undefined}>
      <span className="nx-brand" style={{ fontWeight: 600 }}>{name}</span>
      <Crumb />
      <button type="button" id="nx-search" className="nx-search" aria-haspopup="dialog" aria-label={t("Search, ask, or type a command")} onClick={onOpenCommand}>
        <Icon name="search" size={16} />
        <span className="nx-search-ph">{t("Search, ask, or type a command")}</span>
        <span className="nx-kbd" aria-hidden="true">{"⌘"}K</span>
      </button>
      <div className="nx-top-r">
        {onObjectPage ? (
          <>
            <button type="button" className="nx-tbtn" aria-label={t("Upload")} onClick={openUpload}><Icon name="upload" size={16} /></button>
            <button type="button" className="nx-tbtn" aria-label={t("Download")} onClick={openDownload}><Icon name="download" size={16} /></button>
          </>
        ) : null}
        <button type="button" className="nx-tbtn" aria-haspopup="dialog" aria-expanded={open?.kind === "ask"} onClick={() => toggle("ask")}>{t("Ask Meridian")}</button>
        <button type="button" className="nx-tbtn" aria-haspopup="dialog" aria-expanded={open?.kind === "inbox"} aria-label={t("Inbox {inbox}, unread", { inbox })} onClick={() => toggle("inbox")}>
          {t("Inbox")} <b>{inbox}</b>
        </button>
        <button type="button" className="nx-tbtn" aria-label={theme === "dark" ? t("Switch to light") : t("Switch to dark")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
        </button>
        <Account onShortcuts={onShortcuts} />
      </div>
    </header>
  );
}
