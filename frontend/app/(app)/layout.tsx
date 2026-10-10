"use client";

import type { ReactNode } from "react";
import { Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Pill, Rail, Skeleton, TopBar, CommandPalette, RunSelector, type RunOption } from "@/design";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useVisibleNav } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { flattenNav, resolveNavHref } from "@/lib/nav";
import { getVersions } from "@/lib/api/versions";
import { isNotFound } from "@/lib/error";
import { formatDate, formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne } from "@/hooks/use-day-one";

const FINISHED = new Set(["complete", "agents_complete", "ai_enriched"]);

function CommandPaletteSlot() {
  const groups = useVisibleNav();
  const { role } = useRole();
  const items = groups.flatMap((g) => flattenNav(g.items).map((item) => ({ label: item.label, href: resolveNavHref(item.href, role) })));
  return <CommandPalette items={items} />;
}

function RunSelectorSlot() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, error, isLoading, isError, refetch } = useQuery({
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

  if (isLoading) return <Skeleton width={160} height={24} />;
  // A 404 from the runs list means no runs yet; only a real failure gets the error pill.
  if (isError && !isNotFound(error)) {
    return (
      <span className="inline-flex items-center gap-2">
        {/* Below md the pill is dropped so the page title keeps the row; Retry stays and carries the meaning. */}
        <span className="hidden md:inline-flex"><Pill tone="no-go">Runs unavailable</Pill></span>
        <Button variant="ghost" aria-label="Runs unavailable, retry" onClick={() => refetch()}>Retry</Button>
      </span>
    );
  }

  if (versions.length === 0) {
    if (dayOne.status !== "ready" || !dayOne.step) {
      return <span className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-3)" }}>No runs yet</span>;
    }
    if (!dayOne.step.actionable || !dayOne.step.href) {
      return <span className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-3)" }}>{dayOne.step.label}</span>;
    }
    return (
      <Link href={dayOne.step.href} className="text-[13px] leading-[18px]" style={{ color: "var(--m-accent)" }}>
        {dayOne.step.label}
      </Link>
    );
  }

  const runs: RunOption[] = versions.map((v) => ({
    id: v.id,
    label: v.label ?? `${(v.metadata?.modules ?? []).map(formatModuleName).join(", ") || "Run"} · ${formatDate(v.run_at, "date")}`,
  }));
  return <RunSelector runs={runs} />;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen">
        <Suspense fallback={<div style={{ width: 240 }} />}>
          <Rail />
        </Suspense>
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar
            runSelector={<Suspense fallback={<Skeleton width={160} height={24} />}><RunSelectorSlot /></Suspense>}
            commandPalette={<CommandPaletteSlot />}
            userMenu={<ThemeToggle />}
          />
          <main className="flex-1 overflow-auto" style={{ background: "var(--m-canvas)" }}>
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
