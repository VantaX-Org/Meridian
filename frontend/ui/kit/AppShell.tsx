"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface ShellSection { id: string; label: string; href: string; active?: boolean }
export interface ShellMenuItem { id: string; label: string; href?: string; onClick?: () => void }

/** Top bar with sections and a user menu. No left menu. */
/** Two letters: first letters of the first and last word of the name, else the first two of the name or email. */
export function initials(name: string, email?: string): string {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  const base = words.length > 1 ? `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}` : (words[0] ?? email ?? "?").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2);
  return (base || "?").toUpperCase();
}

/** Two tiers: the global bar (brand, context, search, status, Ask Aletheia, account) and the section bar (sections, more, breadcrumbs). */
export function AppShell({ context, environment, locale, crumbs, menuExtra, prod, more, search, dock, brand, sections, navLabel, skipLabel, skipNavLabel, user, userMenuLabel, menu, launcher, aside, banner, actions, children }: { brand: string; sections: ShellSection[]; navLabel: string; skipLabel: string; skipNavLabel: string; user: { name: string; email?: string; meta?: string[] }; userMenuLabel: string; menu: ShellMenuItem[]; /** Violet Aletheia launcher in the top bar. */ launcher?: { label: string; onOpen: () => void }; /** Slot for the lazy AletheiaPanel. */ aside?: ReactNode; /** Lines under the top bar: offline, sandbox, view-as. */ banner?: ReactNode; /** Small controls before the launcher: health word, inbox. */ actions?: ReactNode; children: ReactNode; /** Context switcher after the brand. */ context?: ReactNode; /** Environment badge beside it. */ environment?: ReactNode; /** Locale clock before the launcher. */ locale?: ReactNode; /** Breadcrumbs at the end of the section bar. */ crumbs?: ReactNode; /** Extra block at the top of the account menu (phone: the switcher). */ menuExtra?: ReactNode; /** The selected system is production: a 2px stop-colour top edge on the global bar. */ prod?: boolean; /** Secondary destinations: a menu after the primary sections. */ more?: { label: string; items: ShellMenuItem[] }; /** Jump button that opens the command palette. */ search?: { label: string; hint: string; onOpen: () => void }; /** Aletheia dock at the foot of the screen. */ dock?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open && !moreOpen) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setMoreOpen(false); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open, moreOpen]);
  const initial = initials(user.name, user.email);
  return (
    <div className="mx-shell">
      <nav aria-label={skipNavLabel} className="mx-skip"><a href="#nx-main">{skipLabel}</a></nav>
      <header className="mx-topbar" data-prod={prod ? "" : undefined}>
        <Link href="/" className="mx-brand">{brand}</Link>
        {context}
        {environment}
        <span className="mx-grow" />
        {search ? <button type="button" className="mx-jump" onClick={search.onOpen}>{search.label}<kbd>{search.hint}</kbd></button> : null}
        {actions}
        {locale}
        {launcher ? <button type="button" className="mx-btn mx-launcher" data-tone="aletheia" data-variant="secondary" onClick={launcher.onOpen}>{launcher.label}</button> : null}
        <div className="mx-user" ref={ref}>
          <button type="button" className="mx-avatar" aria-label={userMenuLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{initial}</button>
          {open ? (
            <div className="mx-menu" role="menu">
              <p className="mx-menu-who"><strong>{user.name}</strong>{user.email ? <span className="mx-muted">{user.email}</span> : null}{(user.meta ?? []).map((m) => <span key={m} className="mx-muted">{m}</span>)}</p>
              {menuExtra ? <div className="mx-menu-extra">{menuExtra}</div> : null}
              {menu.map((m) => m.href
                ? <Link key={m.id} href={m.href} role="menuitem" className="mx-menuitem" onClick={() => setOpen(false)}>{m.label}</Link>
                : <button key={m.id} type="button" role="menuitem" className="mx-menuitem" onClick={() => { setOpen(false); m.onClick?.(); }}>{m.label}</button>)}
            </div>
          ) : null}
        </div>
      </header>
      <div className="mx-subbar">
        <nav aria-label={navLabel} className="mx-sections">
          {sections.map((s) => <Link key={s.id} href={s.href} className="mx-section" aria-current={s.active ? "page" : undefined}>{s.label}</Link>)}
        </nav>
        {more ? (
          <div className="mx-user mx-more" ref={moreRef}>
            <button type="button" className="mx-section" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>{more.label}</button>
            {moreOpen ? (
              <div className="mx-menu" role="menu" aria-label={more.label}>
                {more.items.map((m) => m.href
                  ? <Link key={m.id} href={m.href} role="menuitem" className="mx-menuitem" onClick={() => setMoreOpen(false)}>{m.label}</Link>
                  : <button key={m.id} type="button" role="menuitem" className="mx-menuitem" onClick={() => { setMoreOpen(false); m.onClick?.(); }}>{m.label}</button>)}
              </div>
            ) : null}
          </div>
        ) : null}
        {crumbs}
      </div>
      {banner}
      <main id="nx-main" tabIndex={-1} className="mx-main">{children}</main>
      {aside}
      {dock}
    </div>
  );
}
