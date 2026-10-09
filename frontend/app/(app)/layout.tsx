"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Pill, Rail, TopBar, CommandPalette, RunSelector, ToastViewport, type RunOption } from "@/design";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useVisibleNav } from "@/hooks/use-nav";
import { flattenNav } from "@/lib/nav";
import { getVersions } from "@/lib/api/versions";
import { formatDate, formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne } from "@/hooks/use-day-one";

const FINISHED = new Set(["complete", "agents_complete", "ai_enriched"]);

function CommandPaletteSlot() {
  const groups = useVisibleNav();
  const items = groups.flatMap((g) => flattenNav(g.items).map((item) => ({ label: item.label, href: item.href })));
  return <CommandPalette items={items} />;
}

function RunSelectorSlot() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.run("list"),
    queryFn: () => getVersions(),
  });
  const dayOne = useDayOne();

  const versions = data?.versions ?? [];
  const defaultId = versions.find((v) => FINISHED.has(v.status))?.id ?? versions[0]?.id;
  const hasRunParam = searchParams.has("run");

  // Write the default run onto the URL once, so every page under this
  // layout reads a stable ?run= instead of each inferring its own default.
  useEffect(() => {
    if (!hasRunParam && defaultId) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("run", defaultId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRunParam, defaultId]);

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

  if (versions.length === 0) {
    if (dayOne.status !== "ready" || !dayOne.step) return null;
    return (
      <Link href={dayOne.step.href} className="text-[13px] leading-[18px]" style={{ color: "var(--m-accent)" }}>
        {dayOne.step.label}
      </Link>
    );
  }

  const runs: RunOption[] = versions.map((v) => ({
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
      <ToastViewport />
    </AuthGuard>
  );
}
