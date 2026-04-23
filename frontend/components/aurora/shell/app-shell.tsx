/**
 * Aurora <AppShell> — WS4.
 *
 * Two-chrome frame shared by every workspace:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │ TopBar  (48 px)  · breadcrumb + env + ⌘K + user     │
 *   ├──────┬──────────────────────────────────────────────┤
 *   │      │                                              │
 *   │ Rail │                                              │
 *   │ 48px │                  workspace                   │
 *   │      │                                              │
 *   └──────┴──────────────────────────────────────────────┘
 *
 * The rail hosts the workspace switcher; the top bar hosts the breadcrumb,
 * the environment selector, the ⌘K launcher, and the user menu. Neither is
 * allowed to grow past its token heights — the content region always
 * dominates the viewport by spec §9.
 */

import type { ReactNode } from "react";
import { clsx } from "../primitives/internal";

export interface AppShellProps {
  /** Left 48 px rail — typically `<WorkspaceSwitcher />`. */
  rail: ReactNode;
  /** Top 48 px bar — breadcrumb, env, ⌘K launcher, user. */
  topBar: ReactNode;
  /** Main content. Takes the rest of the viewport. */
  children: ReactNode;
  className?: string;
}

export function AppShell({ rail, topBar, children, className }: AppShellProps) {
  return (
    <div className={clsx("aurora-app-shell", className)}>
      <aside className="aurora-app-shell__rail" aria-label="Workspace switcher">
        {rail}
      </aside>
      <header className="aurora-app-shell__topbar" role="banner">
        {topBar}
      </header>
      <main className="aurora-app-shell__content" role="main">
        {children}
      </main>
    </div>
  );
}
