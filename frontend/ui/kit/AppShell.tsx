"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface ShellSection { id: string; label: string; href: string; active?: boolean }
export interface ShellMenuItem { id: string; label: string; href?: string; onClick?: () => void }

/** Top bar with sections and a user menu. No left menu. */
export function AppShell({ brand, sections, navLabel, skipLabel, skipNavLabel, user, userMenuLabel, menu, launcher, aside, children }: { brand: string; sections: ShellSection[]; navLabel: string; skipLabel: string; skipNavLabel: string; user: { name: string; email?: string }; userMenuLabel: string; menu: ShellMenuItem[]; /** Violet Aletheia launcher in the top bar. */ launcher?: { label: string; onOpen: () => void }; /** Slot for the lazy AletheiaPanel. */ aside?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="mx-shell">
      <nav aria-label={skipNavLabel} className="mx-skip"><a href="#nx-main">{skipLabel}</a></nav>
      <header className="mx-topbar">
        <Link href="/" className="mx-brand">{brand}</Link>
        <nav aria-label={navLabel} className="mx-sections">
          {sections.map((s) => <Link key={s.id} href={s.href} className="mx-section" aria-current={s.active ? "page" : undefined}>{s.label}</Link>)}
        </nav>
        {launcher ? <button type="button" className="mx-btn mx-launcher" data-tone="aletheia" data-variant="secondary" onClick={launcher.onOpen}>{launcher.label}</button> : null}
        <div className="mx-user" ref={ref}>
          <button type="button" className="mx-avatar" aria-label={userMenuLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{initial}</button>
          {open ? (
            <div className="mx-menu" role="menu">
              <p className="mx-menu-who"><strong>{user.name}</strong>{user.email ? <span className="mx-muted">{user.email}</span> : null}</p>
              {menu.map((m) => m.href
                ? <Link key={m.id} href={m.href} role="menuitem" className="mx-menuitem" onClick={() => setOpen(false)}>{m.label}</Link>
                : <button key={m.id} type="button" role="menuitem" className="mx-menuitem" onClick={() => { setOpen(false); m.onClick?.(); }}>{m.label}</button>)}
            </div>
          ) : null}
        </div>
      </header>
      <main id="nx-main" tabIndex={-1} className="mx-main">{children}</main>
      {aside}
    </div>
  );
}
