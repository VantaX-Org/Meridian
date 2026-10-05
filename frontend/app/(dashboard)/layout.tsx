"use client";

/**
 * The Meridian shell: a labelled journey sidebar, a 48 px top bar, and the
 * workspace underneath. Workspaces live in lib/workspaces.ts, ⌘1–⌘6 to switch,
 * ⌘K for everything else. The nav itself lives in lib/nav.ts and feeds the
 * palette and the titles here, so a page is never named differently in two
 * places. Pages not yet rebuilt on components/ui-core render inside the
 * legacy host.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import {
  ClipboardList, Database, LayoutDashboard, Moon, Rows3, ScanSearch, Search, Settings2, Sun, Workflow,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, DepthCrumb, type DepthSegment } from "@/components/aurora";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";
import { MeridianMark } from "@/components/meridian/icons";
import { JobRail } from "@/components/shell/job-rail";
import { JourneyNav } from "@/components/shell/journey-nav";
import { AuthGuard, HeaderExportMenu, NotificationBell, UserButton } from "@/components/shell/widgets";
import { useJobStream } from "@/hooks/use-jobs";
import { useNavGate, useVisibleNav } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { useAuroraPrefs } from "@/hooks/use-theme";
import apiClient from "@/lib/api/client";
import { getPageTitle } from "@/lib/nav";
import { AURORA_DETAIL, AURORA_PAGES, HUB_ROUTES, locate, visibleWorkspaces, type WorkspaceId } from "@/lib/workspaces";
import type { HealthResponse } from "@/types/api";

const ICONS: Record<WorkspaceId, React.ReactNode> = {
  "command-centre": <LayoutDashboard size={20} strokeWidth={1.5} />,
  data: <Database size={20} strokeWidth={1.5} />,
  analyse: <ScanSearch size={20} strokeWidth={1.5} />,
  workbench: <ClipboardList size={20} strokeWidth={1.5} />,
  process: <Workflow size={20} strokeWidth={1.5} />,
  admin: <Settings2 size={20} strokeWidth={1.5} />,
};
const DENSITY_NEXT = { compact: "default", default: "comfortable", comfortable: "compact" } as const;

/** Portfolio, hub, tab: the tab comes from ?tab= on a hub, from the page title elsewhere. */
function Crumb({ pathname }: { pathname: string }) {
  const tabId = useSearchParams().get("tab");
  const here = locate(pathname);
  const w = here?.workspace;
  const hubTab = w && HUB_ROUTES.has(pathname)
    ? (w.tabs.find((t) => t.id === tabId) ?? w.tabs.find((t) => !t.hidden))
    : undefined;
  const segments: DepthSegment[] = [{ level: "portfolio", label: "Portfolio", href: "/" }];
  if (w) segments.push({ level: "hub", label: w.label, href: w.href });
  if (hubTab) segments.push({ level: "tab", label: hubTab.label });
  else if (!HUB_ROUTES.has(pathname)) segments.push({ level: "page", label: getPageTitle(pathname) });
  return <DepthCrumb segments={segments} renderLink={({ children: c, ...props }) => <Link {...props}>{c}</Link>} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const gate = useNavGate();
  const { can } = useRole();
  const { theme, density, setTheme, setDensity } = useAuroraPrefs();
  const { open: cmdkOpen, setOpen: setCmdkOpen } = useCommandPalette();
  useVisibleNav(); // nav + palette share lib/nav.ts; titles below come from the same source
  useJobStream();

  const workspaces = useMemo(() => visibleWorkspaces(gate), [gate]);
  const isHub = HUB_ROUTES.has(pathname);
  const isAurora = isHub || AURORA_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/")) || AURORA_DETAIL.test(pathname);

  // ⌘1–⌘6 switch workspace (Alt on Windows/Linux keyboards without a Meta key).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.altKey) || e.ctrlKey || e.shiftKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= workspaces.length) {
        e.preventDefault();
        router.push(workspaces[n - 1].href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workspaces, router]);

  const { data: health } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: async () => (await apiClient.get("/health")).data,
    staleTime: 60_000,
  });
  const licenceOk = health?.licence?.valid;

  return (
    <AppShell
      rail={
        <>
          <Link href="/" className="aurora-rail__mark" aria-label="Meridian home">
            <MeridianMark size={22} />
          </Link>
          <Suspense fallback={null}>
            <JourneyNav workspaces={workspaces} icons={ICONS} />
          </Suspense>
          <Link
            href="/settings/licence"
            className="aurora-rail__licence"
            data-state={licenceOk === true ? "ok" : licenceOk === false ? "bad" : "unknown"}
            title={licenceOk === true ? "Licence valid" : licenceOk === false ? "Licence problem: open licence settings" : "Checking licence"}
            aria-label="Licence"
          />
        </>
      }
      topBar={
        <>
          <Suspense fallback={null}>
            <Crumb pathname={pathname} />
          </Suspense>
          <div className="aurora-topbar__spacer" />
          <JobRail />
          <button type="button" className="aurora-topbar__cmdk aurora-focus-ring" onClick={() => setCmdkOpen(true)}
                  aria-label="Search and go to (Command K)">
            <Search size={14} aria-hidden /> <span>Search and go to</span> <kbd>⌘K</kbd>
          </button>
          {can("export") ? <HeaderExportMenu /> : null}
          <NotificationBell />
          <button type="button" className="aurora-topbar__icon aurora-focus-ring" aria-label="Change density"
                  title={`Density: ${density}`} onClick={() => setDensity(DENSITY_NEXT[density])}>
            <Rows3 size={16} aria-hidden />
          </button>
          <button type="button" className="aurora-topbar__icon aurora-focus-ring"
                  aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
          </button>
          <UserButton />
          <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />
        </>
      }
    >
      {isAurora ? children : (
        <div className="aurora-hub">
          <div className="mn-legacy-host">{children}</div>
        </div>
      )}
    </AppShell>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <Shell>{children}</Shell>
    </AuthGuard>
  );
}
