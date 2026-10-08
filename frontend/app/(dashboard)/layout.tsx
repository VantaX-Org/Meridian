"use client";

import type { ReactNode } from "react";
import { Moon, Rows3, Sun } from "lucide-react";
import { Rail, TopBar, CommandPalette } from "@/design";
import { AuthGuard, HeaderExportMenu, NotificationBell, UserButton } from "@/components/shell/widgets";
import { useVisibleNav } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { useAuroraPrefs } from "@/hooks/use-theme";
import { flattenNav } from "@/lib/nav";

const DENSITY_NEXT = { compact: "default", default: "comfortable", comfortable: "compact" } as const;

function CommandPaletteSlot() {
  const groups = useVisibleNav();
  const items = groups.flatMap((g) => flattenNav(g.items).map((item) => ({ label: item.label, href: item.href })));
  return <CommandPalette items={items} />;
}

function UserMenu() {
  const { theme, density, setTheme, setDensity } = useAuroraPrefs();
  const { can } = useRole();
  return (
    <div className="flex items-center gap-2">
      <NotificationBell />
      {can("export") ? <HeaderExportMenu /> : null}
      <button
        type="button"
        className="aurora-topbar__icon aurora-focus-ring"
        aria-label="Change density"
        title={`Density: ${density}`}
        onClick={() => setDensity(DENSITY_NEXT[density])}
      >
        <Rows3 size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="aurora-topbar__icon aurora-focus-ring"
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
      </button>
      <UserButton />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen">
        <Rail />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar commandPalette={<CommandPaletteSlot />} userMenu={<UserMenu />} />
          <main className="flex-1 overflow-auto" style={{ background: "var(--m-canvas)" }}>
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
