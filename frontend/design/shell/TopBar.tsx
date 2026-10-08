"use client";

import { Breadcrumb } from "./Breadcrumb";
import { JobTray } from "./JobTray";
import { Suspense, type ReactNode } from "react";

export function TopBar({ runSelector, commandPalette, userMenu }: { runSelector?: ReactNode; commandPalette?: ReactNode; userMenu?: ReactNode }) {
  return (
    <header
      className="flex items-center justify-between px-4 h-12 border-b"
      style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}
    >
      <Suspense fallback={null}>
        <Breadcrumb />
      </Suspense>
      <div className="flex items-center gap-3">
        {runSelector}
        {commandPalette}
        <JobTray />
        {userMenu}
      </div>
    </header>
  );
}
