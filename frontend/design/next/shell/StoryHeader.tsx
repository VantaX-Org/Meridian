"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { PERSONA_LABEL, useOpenItem, useV2Session, type V2Persona } from "@/lib/v2/hooks";
import { canAdminister } from "@/lib/v2/admin-sections";
import { setPersonaOverride } from "@/lib/v2/prefs";
import { productName, useTenantTheme } from "@/lib/v2/theme";
import { t } from "@/lib/v2/i18n";
import { Icon } from "../Icon";
import { Popover } from "../kit/Popover";
import { useSheets } from "./SheetHost";

const PERSONAS: V2Persona[] = ["lead", "steward", "basis", "owner", "process", "admin", "analyst", "auditor", "viewer"];

/** Two letters for the avatar-less account button: the initials of the name, else of the role. */
export function initialsOf(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}

function AccountMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const session = useV2Session();
  const { logout } = useAuth();
  const { openItem } = useOpenItem();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const who = session.name || session.label;
  const first = who.split(/\s+/)[0];
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const next = PERSONAS[(PERSONAS.indexOf(session.persona) + 1) % PERSONAS.length];
  return (
    <>
      <button ref={setAnchor} type="button" className="nx-account-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t("Account, {label}", { label: who })} onClick={() => setOpen((v) => !v)}>
        <span className="nx-avatar" aria-hidden="true">{initialsOf(who)}</span>
        <span className="nx-account-name">{first}</span>
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom" label={t("Account")}>
        <div className="nx-pop-who">
          <b>{who}</b>
          <span>{session.email ?? PERSONA_LABEL[session.persona]}</span>
        </div>
        <button type="button" role="menuitem" className="nx-pop-item" onClick={pick(() => openItem({ kind: "preferences", id: "" }))}>{t("Account")}</button>
        {canAdminister(session.can) ? (
          <Link role="menuitem" className="nx-pop-item" href="/admin" onClick={() => setOpen(false)}>{t("Administration")}</Link>
        ) : null}
        <button type="button" role="menuitem" className="nx-pop-item" onClick={pick(onShortcuts)}>{t("Shortcuts")}</button>
        <button type="button" role="menuitem" className="nx-pop-item" onClick={pick(() => openItem({ kind: "help", id: "" }))}>{t("Help")}</button>
        {session.fixture ? (
          <button type="button" role="menuitem" className="nx-pop-item" onClick={pick(() => setPersonaOverride(next))}>{t("Switch persona to {label}", { label: PERSONA_LABEL[next] })}</button>
        ) : null}
        {session.fixture ? null : (
          <>
            <hr className="nx-pop-rule" />
            <button type="button" role="menuitem" className="nx-pop-item" onClick={pick(() => void logout())}>{t("Sign out")}</button>
          </>
        )}
      </Popover>
    </>
  );
}

/** The 56 px glass bar: wordmark, the title slot a collapsed large title fills, search, Ask Aletheia, account. */
export function StoryHeader({ onShortcuts }: { onShortcuts: () => void }) {
  const name = productName(useTenantTheme());
  const sheets = useSheets();
  const askOpen = sheets.stack.some((s) => s.kind === "ask");
  return (
    <header className="nx-header nx-glass">
      <Link href="/" className="nx-wordmark">{name}</Link>
      <div id="nx-title-slot" className="nx-title-slot" />
      <div className="nx-header-r">
        <button type="button" id="nx-search" className="nx-header-btn" aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K" aria-label={t("Search, ask, or type a command")} onClick={() => sheets.open({ kind: "command", id: "" })}>
          <Icon name="search" size={16} />
          <span className="nx-header-label">{t("Search")}</span>
        </button>
        <button type="button" className="nx-header-btn" aria-haspopup="dialog" aria-expanded={askOpen} onClick={() => sheets.open({ kind: "ask", id: "" })}>
          <Icon name="sparkles" size={16} />
          <span className="nx-header-label">{t("Ask Aletheia")}</span>
        </button>
        <AccountMenu onShortcuts={onShortcuts} />
      </div>
    </header>
  );
}
