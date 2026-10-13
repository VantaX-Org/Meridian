"use client";

import type { ReactNode } from "react";
import { Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Pill, Rail, Skeleton, TopBar, CommandPalette, RootPageFrame, RunSelector, type RunOption } from "@/design";
import { UserMenu } from "@/components/user-menu";
import { useJobs } from "@/hooks/use-jobs";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useVisibleNav } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { flattenNav, resolveNavHref } from "@/lib/nav";
import { getVersions } from "@/lib/api/versions";
import { getSystems } from "@/lib/api/connectivity";
import { getObjects } from "@/lib/api/v1/objects";
import { isNotFound } from "@/lib/error";
import { formatDate, formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne } from "@/hooks/use-day-one";
import { PermissionsProvider, usePermissions } from "@/lib/permissions";
import { ScopedPill } from "@/components/scoped-pill";
import { RouteInsight } from "@/components/insight/route-insight";
import { reportClientError } from "@/lib/client-errors";

const FINISHED = new Set(["complete", "agents_complete", "ai_enriched"]);

function CommandPaletteSlot() {
  const groups = useVisibleNav();
  const { role } = useRole();
  const items = groups.flatMap((g) =>
    flattenNav(g.items).map((item) => ({
      label: item.label,
      href: resolveNavHref(item.href, role),
      group: g.group,
      icon: <item.icon size={16} aria-hidden />,
      shortcut: item.shortcut,
    })),
  );
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const objectsQ = useQuery({ queryKey: queryKeys.objects("latest"), queryFn: () => getObjects("latest") });
  const grammar = {
    objects: (objectsQ.data?.objects ?? []).map((o) => ({ module: o.module, label: o.label })),
    systems: [...new Set((systemsQ.data ?? []).map((s) => s.environment))],
  };
  return <CommandPalette items={items} grammar={grammar} />;
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
  const { scopeFilter } = usePermissions();

  const versions = data?.versions ?? [];
  // A scoped user's default run is one from a system in scope (ruling 7).
  const pickable = scopeFilter.systems
    ? versions.filter((v) => v.metadata?.system_id !== undefined && scopeFilter.systems?.has(v.metadata.system_id))
    : versions;
  const defaultId = pickable.find((v) => FINISHED.has(v.status))?.id ?? pickable[0]?.id;
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
    systemId: v.metadata?.system_id,
    at: v.run_at,
    label: v.label ?? `${(v.metadata?.modules ?? []).map(formatModuleName).join(", ") || "Run"}, ${formatDate(v.run_at, "date")}`,
  }));
  return <RunSelector runs={runs} systems={scopeFilter.systems} />;
}

/** 2px track at the top of the content column; the accent fill shows only while a job runs. The track is always
 * rendered so the layout below never shifts. */
function JobProgressBar() {
  const { active } = useJobs();
  const percent = active.length === 0
    ? 0
    : Math.min(100, Math.max(0, Math.round(active.reduce((n, j) => n + (j.percent ?? 0), 0) / active.length)));
  return (
    <div aria-hidden="true" className="shrink-0" style={{ height: 2 }}>
      {active.length > 0 && <div className="m-motion-width" style={{ height: "100%", width: `${percent}%`, background: "var(--m-accent)" }} />}
    </div>
  );
}

/** Reports promise rejections nothing handled; render errors go through error.tsx. */
function useUnhandledRejectionReporting() {
  useEffect(() => {
    const onRejection = (ev: PromiseRejectionEvent) => reportClientError(ev.reason);
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
}

export default function AppLayout({ children }: { children: ReactNode }) {
  useUnhandledRejectionReporting();
  return (
    <AuthGuard>
      <PermissionsProvider>
      <a href="#main" className="m-skip-link">Skip to content</a>
      <div className="flex h-screen">
        <Suspense fallback={<div style={{ width: 240 }} />}>
          <Rail />
        </Suspense>
        <div className="flex flex-col flex-1 overflow-hidden">
          <JobProgressBar />
          <TopBar
            runSelector={<Suspense fallback={<Skeleton width={160} height={24} />}><RunSelectorSlot /></Suspense>}
            commandPalette={<CommandPaletteSlot />}
            userMenu={<span className="inline-flex items-center gap-2"><ScopedPill /><UserMenu /></span>}
          />
          <main id="main" tabIndex={-1} className="flex-1 overflow-auto outline-none" style={{ background: "var(--m-canvas)" }}>
            <Suspense fallback={null}><RouteInsight /></Suspense>
            <RootPageFrame>{children}</RootPageFrame>
          </main>
        </div>
      </div>
      </PermissionsProvider>
    </AuthGuard>
  );
}
