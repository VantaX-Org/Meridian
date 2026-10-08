"use client";

import type { ReactNode } from "react";
import { Rail, TopBar, CommandPalette, ToastViewport } from "@/design";
import { AuthGuard } from "@/components/shell/widgets";
import { useVisibleNav } from "@/hooks/use-nav";
import { flattenNav } from "@/lib/nav";

function CommandPaletteSlot() {
  const groups = useVisibleNav();
  const items = groups.flatMap((g) => flattenNav(g.items).map((item) => ({ label: item.label, href: item.href })));
  return <CommandPalette items={items} />;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen">
        <Rail />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar commandPalette={<CommandPaletteSlot />} />
          <main className="flex-1 overflow-auto" style={{ background: "var(--m-canvas)" }}>
            {children}
          </main>
        </div>
      </div>
      <ToastViewport />
    </AuthGuard>
  );
}
