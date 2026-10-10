"use client";

import { Breadcrumb } from "./Breadcrumb";
import { JobTray } from "./JobTray";
import { Suspense, type ReactNode } from "react";

export function TopBar({ runSelector, commandPalette, userMenu }: { runSelector?: ReactNode; commandPalette?: ReactNode; userMenu?: ReactNode }) {
  return (
    <header
      className="flex items-center justify-between gap-2 px-3 md:px-6 h-12 border-b"
      style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}
    >
      <Suspense fallback={null}>
        <Breadcrumb />
      </Suspense>
      <div className="flex shrink-0 items-center gap-2 md:gap-3 whitespace-nowrap">
        <Suspense fallback={null}>{runSelector}</Suspense>
        {commandPalette}
        <JobTray />
        {userMenu}
      </div>
    </header>
  );
}
