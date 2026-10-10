"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Pill, Rail, TopBar, CommandPalette, RunSelector, type RunOption } from "@/design";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useVisibleNav } from "@/hooks/use-nav";
import { flattenNav } from "@/lib/nav";
import { getVersions } from "@/lib/api/versions";
import { formatDate, formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

function CommandPaletteSlot() {
  const groups = useVisibleNav();
  const items = groups.flatMap((g) => flattenNav(g.items).map((item) => ({ label: item.label, href: item.href })));
  return <CommandPalette items={items} />;
}

function RunSelectorSlot() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.run("list"),
    queryFn: () => getVersions(),
  });
  if (isLoading) return null;
  if (isError || !data) {
    return (
      <span className="inline-flex items-center gap-2">
        <RunSelector runs={[]} />
        <Pill tone="no-go">Runs unavailable</Pill>
        <Button variant="ghost" onClick={() => refetch()}>Retry</Button>
      </span>
    );
  }

  const runs: RunOption[] = data.versions.map((v) => ({
    id: v.id,
    label: v.label ?? `${(v.metadata?.modules ?? []).map(formatModuleName).join(", ") || "Run"}, ${formatDate(v.run_at, "date")}`,
  }));
  return <RunSelector runs={runs} />;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen">
        <Rail />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar runSelector={<RunSelectorSlot />} commandPalette={<CommandPaletteSlot />} />
          <main className="flex-1 overflow-auto" style={{ background: "var(--m-canvas)" }}>
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
