"use client";

import type { ReactNode } from "react";
import { Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb, Button, NotificationBell, Pill, Rail, Skeleton, TopBar, CommandPalette, RootPageFrame, RunSelector, type RunOption } from "@/design";
import "@/design/print.css";
import { UserMenu } from "@/components/user-menu";
import { useAuth } from "@/context/auth-context";
import { useJobs } from "@/hooks/use-jobs";
import { VIEWS } from "@/app/(app)/insights/_components/InsightViews";
import { BarChart3 } from "lucide-react";
import { usePreferencesSync } from "@/hooks/use-preferences";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useVisibleNav } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { flattenNav, resolveNavHref } from "@/lib/nav";
import { useRunListWith } from "@/hooks/use-run-list";
import { isFinished } from "@/lib/runs";
import { getSystems } from "@/lib/api/connectivity";
import { getObjects } from "@/lib/api/v1/objects";
import { isNotFound } from "@/lib/error";
import { formatDate, formatModuleName, runOptionLabels } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne } from "@/hooks/use-day-one";
import { PermissionsProvider, usePermissions } from "@/lib/permissions";
import { ScopedPill } from "@/components/scoped-pill";
import { RouteInsight } from "@/components/insight/route-insight";
import { HelpSlot } from "@/components/help/help-slot";
import { reportClientError } from "@/lib/client-errors";


function CommandPaletteSlot() {
  const groups = useVisibleNav();
  const { role } = useRole();
  const navItems = groups.flatMap((g) =>
    flattenNav(g.items).map((item) => ({
      label: item.label,
      href: resolveNavHref(item.href, role),
      group: g.group,
      icon: <item.icon size={16} aria-hidden />,
      shortcut: item.shortcut,
    })),
  );
  // The insight views' tabs are not nav entries; they stay reachable by name from the palette.
  const seen = new Set(navItems.map((i) => i.href));
  const insightsGroup = groups.find((g) => g.items.some((i) => i.href === "/insights"))?.group;
  const viewTabs = insightsGroup
    ? VIEWS.flatMap((v) => v.tabs.filter(([href]) => href.startsWith("/insights") && !seen.has(href)).map(([href, label]) => ({
        label: `${v.label}: ${label}`, href, group: insightsGroup, icon: <BarChart3 size={16} aria-hidden />, shortcut: undefined,
      })))
    : [];
  const items = [...navItems, ...viewTabs];
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
  // A run page's own id is its scope; otherwise the URL's ?run=. A run older than the shared list is read by id.
  const routeRun = /^\/runs\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname ?? "")?.[1];
  const { list, versions } = useRunListWith(searchParams.get("run") ?? routeRun);
  const { error, isLoading, isError, refetch } = list;
  const dayOne = useDayOne();
  const { scopeFilter } = usePermissions();

  // A scoped user's default run is one from a system in scope (ruling 7).
  const pickable = scopeFilter.systems
    ? versions.filter((v) => v.metadata?.system_id !== undefined && scopeFilter.systems?.has(v.metadata.system_id))
    : versions;
  const defaultId = routeRun ?? pickable.find(isFinished)?.id ?? pickable[0]?.id;
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
      return <span className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No runs yet</span>;
    }
    if (!dayOne.step.actionable || !dayOne.step.href) {
      return <span className="m-text-body" style={{ color: "var(--m-ink-3)" }}>{dayOne.step.label}</span>;
    }
    return (
      <Link href={dayOne.step.href} className="m-text-body" style={{ color: "var(--m-accent)" }}>
        {dayOne.step.label}
      </Link>
    );
  }

  // Runs that share a label (ten uploads of one file) are told apart by their date and time.
  const names = runOptionLabels(versions.map((v) => ({
    id: v.id,
    run_at: v.run_at,
    label: v.label ?? `${(v.metadata?.modules ?? []).map(formatModuleName).join(", ") || "Run"}, ${formatDate(v.run_at, "date")}`,
  })));
  const runs: RunOption[] = versions.map((v) => ({
    id: v.id,
    systemId: v.metadata?.system_id,
    at: v.run_at,
    label: names.get(v.id) ?? v.label ?? v.id,
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
    <div aria-hidden="true" className="shrink-0 m-print-hide" style={{ height: 2 }}>
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

/** Loads the user's server-side preferences once after sign-in and keeps them in step with local changes. */
function PreferencesSync() {
  usePreferencesSync(useAuth().user?.id);
  return null;
}

/** `?present=1` shows the page alone, full width, for a boardroom screen; Escape or the button returns to the shell. */
function Presentation({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const exit = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("present");
    router.replace(params.size ? `${pathname}?${params}` : pathname);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);
  return (
    <div className="flex h-screen flex-col" data-present="1">
      {/* The shell is gone, so the document heading the Breadcrumb owns is kept here, visually hidden. */}
      <div className="sr-only"><Breadcrumb /></div>
      <main id="main" tabIndex={0} className="flex-1 overflow-auto outline-none" style={{ background: "var(--m-canvas)" }}>
        <RootPageFrame>{children}</RootPageFrame>
      </main>
      <div className="fixed bottom-4 right-4 m-print-hide">
        <Button variant="secondary" onClick={exit}>Exit presentation</Button>
      </div>
    </div>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const present = useSearchParams().get("present") === "1";
  if (present) return <Presentation>{children}</Presentation>;
  return (
      <div className="flex h-screen m-print-flow">
        <Suspense fallback={<div style={{ width: 240 }} />}>
          <Rail />
        </Suspense>
        <div className="flex flex-col flex-1 overflow-hidden m-print-flow">
          <JobProgressBar />
          <TopBar
            runSelector={<Suspense fallback={<Skeleton width={160} height={24} />}><RunSelectorSlot /></Suspense>}
            commandPalette={<CommandPaletteSlot />}
            helpMenu={<HelpSlot />}
            notifications={<NotificationBell />}
            userMenu={<span className="inline-flex items-center gap-2"><ScopedPill /><UserMenu /></span>}
          />
          <main id="main" tabIndex={0} className="flex-1 overflow-auto outline-none m-print-flow" style={{ background: "var(--m-canvas)" }}>
            <Suspense fallback={null}><RouteInsight /></Suspense>
            <RootPageFrame>{children}</RootPageFrame>
          </main>
        </div>
      </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  useUnhandledRejectionReporting();
  return (
    <AuthGuard>
      <PermissionsProvider>
      <a href="#main" className="m-skip-link">Skip to content</a>
      <PreferencesSync />
      <Suspense fallback={null}><Chrome>{children}</Chrome></Suspense>
      </PermissionsProvider>
    </AuthGuard>
  );
}
