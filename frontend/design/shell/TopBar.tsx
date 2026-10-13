"use client";

import { Breadcrumb } from "./Breadcrumb";
import { JobTray } from "./JobTray";
import { Suspense, type ReactNode } from "react";

export function TopBar({ runSelector, commandPalette, notifications, userMenu }: { runSelector?: ReactNode; commandPalette?: ReactNode; notifications?: ReactNode; userMenu?: ReactNode }) {
  return (
    <header
      className="z-20 flex shrink-0 items-center justify-between gap-2 m-print-hide"
      style={{ height: "var(--m-topbar-h)", padding: "0 24px", background: "var(--m-sheet)", borderBottom: "1px solid var(--m-line)" }}
    >
      <Suspense fallback={null}>
        <Breadcrumb />
      </Suspense>
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        <Suspense fallback={null}>{runSelector}</Suspense>
        {commandPalette}
        <JobTray />
        {notifications}
        {userMenu}
      </div>
    </header>
  );
}
