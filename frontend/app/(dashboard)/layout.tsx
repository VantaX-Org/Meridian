"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import {
  User,
  Bell,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
  Download,
  FileText,
  FileJson,
  FileSpreadsheet,
  List,
  LogOut,
} from "lucide-react";

function LocalUserButton() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const initials = user
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  const handleSignOut = () => {
    setOpen(false);
    logout();
    router.push("/sign-in");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Account"
            aria-label="Account"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
          />
        }
      >
        {initials}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 overflow-hidden rounded-2xl p-0 shadow-xl" sideOffset={8}>
        {user && (
          <div className="border-b border-black/[0.06] px-4 py-3">
            <p className="text-sm font-semibold text-foreground truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        )}
        <div className="p-1.5">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-black/[0.04] hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const UserButton = LocalUserButton;

/**
 * Header-bar export dropdown.
 *
 * Resolves the most recent ``agents_complete`` version and offers direct
 * downloads for its PDF report, JSON report, and config-matches workbook.
 * No hardcoded URLs or version IDs — everything is keyed off the first
 * completed version returned by ``/api/v1/versions``. If there is no
 * completed version yet the menu items are disabled.
 */
function HeaderExportMenu() {
  const { data, isLoading } = useQuery({
    queryKey: ["header-export-latest-version"],
    queryFn: () => getVersions({ limit: 10 }),
    staleTime: 30_000,
  });

  const latestComplete = (data?.versions ?? []).find(
    (v) => v.status === "agents_complete",
  );
  const hasReport = Boolean(latestComplete);
  const latestLabel = latestComplete?.label
    ? `“${latestComplete.label}”`
    : latestComplete
      ? new Date(latestComplete.run_at).toLocaleString()
      : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="hidden sm:flex items-center gap-1.5 rounded-xl bg-[#EA580C] px-4 py-2 text-sm font-medium text-white hover:bg-[#C24B08] transition-colors shadow-[0_0_12px_rgba(255,140,66,0.20)]"
          />
        }
      >
        <Download className="h-4 w-4" />
        Export
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            {isLoading
              ? "Finding latest analysis…"
              : hasReport
                ? `Latest analysis: ${latestLabel}`
                : "No completed analysis yet"}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={!hasReport}
          render={
            hasReport ? (
              <a
                href={getReportDownloadUrl(latestComplete!.id)}
                download
                className="flex items-center gap-2 cursor-pointer"
              />
            ) : undefined
          }
        >
          <FileText className="h-4 w-4" />
          <span>Download PDF report</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={!hasReport}
          render={
            hasReport ? (
              <a
                href={getReportJsonExportUrl(latestComplete!.id)}
                download
                className="flex items-center gap-2 cursor-pointer"
              />
            ) : undefined
          }
        >
          <FileJson className="h-4 w-4" />
          <span>Download JSON report</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={!hasReport}
          render={
            hasReport ? (
              <a
                href={getConfigMatchesExportUrl(latestComplete!.id)}
                download
                className="flex items-center gap-2 cursor-pointer"
              />
            ) : undefined
          }
        >
          <FileSpreadsheet className="h-4 w-4" />
          <span>Download config matches (xlsx)</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={
            <Link href="/reports" className="flex items-center gap-2 cursor-pointer" />
          }
        >
          <List className="h-4 w-4" />
          <span>View all reports</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import {
  LayoutDashboard,
  Upload,
  AlertTriangle,
  GitCompareArrows,
  Settings,
  ShieldCheck,
  GitMerge,
  ShieldAlert,
  BarChart3,
  FileCheck2,
  Server,
  RefreshCw,
  BookOpen,
  ClipboardList,
  Database,
  Network,
  Eraser,
  BrainCircuit,
  Play,
  Sliders,
  Map,
  Plug2,
  AlertOctagon,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import "@/app/sidebar-responsive.css";
import { useAuth } from "@/context/auth-context";
import { AskMeridian } from "@/components/ask-meridian";
import { useRole } from "@/hooks/use-role";
import { useLicence } from "@/hooks/use-licence";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api/client";
import { getVersions } from "@/lib/api/versions";
import {
  getReportDownloadUrl,
  getReportJsonExportUrl,
} from "@/lib/api/reports";
import { getConfigMatchesExportUrl } from "@/lib/api/config-matches";
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/api/notifications";
import { relativeTime } from "@/lib/format";
import type { HealthResponse, Notification as NotifType } from "@/types/api";

/* ─── Page title mapping ─── */
const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/systems": "SAP Systems",
  "/sync": "Sync Monitor",
  "/upload": "Import Data",
  "/golden-records": "Golden Records",
  "/glossary": "Business Glossary",
  "/contracts": "Data Contracts",
  "/relationships": "Relationships",
  "/stewardship": "Stewardship",
  "/ai/rules": "AI Rules",
  "/exceptions": "Exceptions",
  "/cleaning": "Cleaning Queue",
  "/dedup": "Deduplication",
  "/match-rules": "Match Rules",
  "/findings": "Findings",
  "/analytics": "Analytics",
  "/run-sync": "Run Sync",
  "/reports": "Reports",
  "/versions": "Versions",
  "/settings": "Settings",
  "/settings/rules": "Rules Engine",
  "/settings/field-mapping": "SAP Field Mapping",
  "/connectivity": "Connectivity",
  "/config-impact": "Config Impact",
  "/business-process": "Business Processes",
  "/notifications": "Notifications",
  "/users": "User Management",
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (pathname.startsWith(path + "/")) return title;
  }
  return "Meridian";
}

/* ─── Notification bell ─── */
const NOTIF_TYPE_ICONS: Record<string, string> = {
  finding: "🔍",
  cleaning: "✨",
  exception: "🚨",
  approval: "✅",
  digest: "📊",
  warning: "⚠️",
};

function NotificationBell() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
  });

  const { data: recent } = useQuery({
    queryKey: ["notifications-recent"],
    queryFn: () => getNotifications({ limit: 10 }),
    enabled: open,
  });

  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-recent"] });
    },
  });

  const handleClick = async (notif: NotifType) => {
    if (!notif.is_read) {
      await markNotificationRead(notif.id);
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-recent"] });
    }
    if (notif.link) {
      setOpen(false);
      router.push(notif.link);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Notifications"
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-black/[0.04] hover:text-foreground"
          />
        }
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white ring-2 ring-[#F7F8FA]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 overflow-hidden rounded-2xl p-0 shadow-xl" sideOffset={8}>
        <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
          <span className="font-display text-sm font-semibold text-foreground">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllMutation.mutate()}
              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {(!recent?.items || recent.items.length === 0) ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            recent.items.map((notif) => (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleClick(notif)}
                className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.03] ${
                  notif.is_read ? "opacity-50" : ""
                }`}
              >
                <span className="mt-0.5 text-sm">{NOTIF_TYPE_ICONS[notif.type] || "📋"}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{notif.title}</p>
                  <p className="truncate text-xs text-muted-foreground mt-0.5">
                    {notif.body.length > 60 ? notif.body.slice(0, 60) + "…" : notif.body}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{relativeTime(notif.created_at)}</p>
                </div>
                {!notif.is_read && (
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-black/[0.06] px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push("/notifications");
            }}
            className="w-full text-center text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View all notifications
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Nav config ─── */
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  licenceKey?: string; // menu item key in licence manifest
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: "Analyse",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, licenceKey: "dashboard" },
      { href: "/upload", label: "Import", icon: Upload, licenceKey: "import" },
      { href: "/findings", label: "Findings", icon: AlertTriangle, licenceKey: "findings" },
      { href: "/analytics", label: "Analytics", icon: BarChart3, licenceKey: "analytics" },
      { href: "/nlp", label: "Ask AI", icon: BrainCircuit, licenceKey: "nlp" },
      { href: "/run-sync", label: "Run Sync", icon: Play, licenceKey: "sync" },
    ],
  },
  {
    group: "Report",
    items: [
      { href: "/reports", label: "Reports", icon: FileText, licenceKey: "reports" },
      { href: "/versions", label: "Versions", icon: GitCompareArrows, licenceKey: "versions" },
    ],
  },
  {
    group: "Govern",
    items: [
      { href: "/golden-records", label: "Golden Records", icon: Database },
      { href: "/glossary", label: "Glossary", icon: BookOpen },
      { href: "/contracts", label: "Contracts", icon: FileCheck2, licenceKey: "contracts" },
      { href: "/relationships", label: "Relationships", icon: Network },
    ],
  },
  {
    group: "Steward",
    items: [
      { href: "/stewardship", label: "Workbench", icon: ClipboardList, licenceKey: "stewardship" },
      { href: "/ai/rules", label: "AI Rules", icon: BrainCircuit, permission: "review_ai_rules" },
      { href: "/exceptions", label: "Exceptions", icon: ShieldAlert },
      { href: "/cleaning", label: "Cleaning", icon: Eraser },
      { href: "/dedup", label: "Dedup", icon: GitMerge },
    ],
  },
  {
    group: "Connect",
    items: [
      { href: "/systems", label: "Systems", icon: Server },
      { href: "/connectivity", label: "Connectivity", icon: Plug2 },
      { href: "/sync", label: "Sync Monitor", icon: RefreshCw },
      { href: "/config-impact", label: "Config Impact", icon: AlertOctagon },
      { href: "/business-process", label: "Processes", icon: Workflow },
    ],
  },
];

const ROLES_WITH_AI_RULES = ["admin", "steward", "ai_reviewer"];

// Settings sub-nav items (admin-only)
import { Key } from "lucide-react";

interface SettingsNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: string;
  licenceKey?: string;
}

const SETTINGS_SUB_NAV: SettingsNavItem[] = [
  { href: "/settings/rules", label: "Rules Engine", icon: Sliders, permission: "manage_rules", licenceKey: "rules_engine" },
  { href: "/settings/field-mapping", label: "Field Mapping", icon: Map, permission: "manage_field_mappings", licenceKey: "field_mapping" },
  { href: "/settings/licence", label: "Licence", icon: Key, permission: "view", licenceKey: "licence" },
];

/*
 * Sidebar content — uses data-* attributes for CSS-driven responsive collapse.
 * Between lg (1024px) and xl (1280px), globals.css hides labels and collapses
 * the sidebar to 72px via aside[data-sidebar] selectors.
 * When user manually collapses, JS `collapsed` prop hides labels directly.
 */
function SidebarNav({
  collapsed,
  pathname,
  userRole,
  onNavClick,
}: {
  collapsed: boolean;
  pathname: string;
  userRole: string;
  onNavClick?: () => void;
}) {
  const { can } = useRole();
  const { isMenuItemEnabled } = useLicence();

  return (
    <nav className="flex flex-col gap-5">
      {NAV_GROUPS.map(({ group, items }) => {
        const visibleItems = items.filter((item) => {
          if (item.permission === "review_ai_rules") {
            if (!ROLES_WITH_AI_RULES.includes(userRole)) return false;
          }
          // Check licence: item must be enabled in manifest
          if (item.licenceKey && !isMenuItemEnabled(item.licenceKey)) return false;
          return true;
        });
        if (visibleItems.length === 0) return null;

        return (
          <div key={group}>
            {!collapsed && (
              <span data-sidebar-label className="mb-1.5 block px-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group}
              </span>
            )}
            {collapsed && (
              <div className="mb-1 mx-auto w-6 border-t border-black/[0.06]" />
            )}
            {!collapsed && (
              <div data-sidebar-divider className="hidden mb-1 mx-auto w-6 border-t border-black/[0.06]" />
            )}
            <div className="flex flex-col gap-0.5">
              {visibleItems.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    data-sidebar-link
                    title={label}
                    onClick={onNavClick}
                    className={`group relative flex items-center gap-3 rounded-xl transition-all duration-150 ${
                      collapsed
                        ? "mx-auto h-10 w-10 justify-center"
                        : "mx-1 px-3 py-2"
                    } ${
                      active
                        ? "bg-primary/[0.15] text-primary border border-primary/25 shadow-[0_0_12px_rgba(13,86,57,0.15)]"
                        : "text-[#6B7280] hover:bg-black/[0.04] hover:text-foreground border border-transparent"
                    }`}
                  >
                    <Icon data-sidebar-icon className={`shrink-0 ${collapsed ? "h-5 w-5" : "h-[18px] w-[18px]"}`} />
                    {!collapsed && (
                      <span data-sidebar-label className="text-base font-medium truncate">{label}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Settings — with admin-only sub-items */}
      <div>
        {collapsed && <div className="mb-1 mx-auto w-6 border-t border-black/[0.06]" />}
        {!collapsed && <div data-sidebar-divider className="hidden mb-1 mx-auto w-6 border-t border-black/[0.06]" />}
        <Link
          href="/settings"
          data-sidebar-link
          title="Settings"
          onClick={onNavClick}
          className={`group relative flex items-center gap-3 rounded-xl transition-all duration-150 ${
            collapsed
              ? "mx-auto h-10 w-10 justify-center"
              : "mx-1 px-3 py-2"
          } ${
            pathname === "/settings"
              ? "bg-primary/[0.15] text-primary border border-primary/25 shadow-[0_0_12px_rgba(13,86,57,0.15)]"
              : "text-[#6B7280] hover:bg-black/[0.04] hover:text-foreground border border-transparent"
          }`}
        >
          <Settings data-sidebar-icon className={`shrink-0 ${collapsed ? "h-5 w-5" : "h-[18px] w-[18px]"}`} />
          {!collapsed && <span data-sidebar-label className="text-base font-medium">Settings</span>}
        </Link>

        {/* Admin-only settings sub-items (only shown expanded + admin role) */}
        {!collapsed && (
          <div className="mt-0.5 ml-3 flex flex-col gap-0.5">
            {SETTINGS_SUB_NAV.filter(
              (item) => can(item.permission) && (!item.licenceKey || isMenuItemEnabled(item.licenceKey))
            ).map(
              ({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    data-sidebar-link
                    title={label}
                    onClick={onNavClick}
                    className={`group flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-sm transition-all duration-150 ${
                      active
                        ? "bg-primary/[0.12] text-primary border border-primary/20"
                        : "text-[#6B7280] hover:bg-black/[0.04] hover:text-foreground border border-transparent"
                    }`}
                  >
                    <Icon className="h-[15px] w-[15px] shrink-0" />
                    <span data-sidebar-label className="font-medium truncate">{label}</span>
                  </Link>
                );
              }
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

/* ─── Auth guard (local mode) ─── */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/sign-in");
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}

/* ─── Main layout ─── */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Persist sidebar collapse preference
  useEffect(() => {
    const saved = localStorage.getItem("mn_sidebar_collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("mn_sidebar_collapsed", String(next));
      return next;
    });
  }, []);

  // Close mobile sidebar on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sidebarOpen) setSidebarOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const { data: health } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: async () => (await apiClient.get("/health")).data,
    staleTime: 60_000,
  });

  const licence = health?.licence;
  const licenceDotColor =
    licence?.valid === true
      ? "bg-[#16A34A]"
      : licence?.valid === false
        ? "bg-destructive"
        : "bg-muted-foreground";
  const licencePulse = licence?.valid === true ? "animate-[vx-pulse-dot_2s_ease-in-out_infinite]" : "";

  const { role: userRole } = useRole();
  const pageTitle = getPageTitle(pathname);

  const content = (
    <div className="flex h-screen overflow-hidden vx-mesh-bg">
      {/* ── Mobile backdrop ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        data-sidebar
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-[rgba(255,255,255,0.75)] backdrop-blur-xl border-r border-black/[0.06] transition-all duration-300 ease-in-out lg:relative lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${
          collapsed ? "lg:w-[72px]" : "lg:w-[260px]"
        } w-[280px]`}
      >
        {/* Logo */}
        <div data-sidebar-header className={`flex h-16 shrink-0 items-center border-b border-black/[0.06] ${collapsed ? "justify-center px-2" : "justify-between px-5"}`}>
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-[0_0_16px_rgba(13,86,57,0.30)]">
              <ShieldCheck className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            {!collapsed && (
              <div data-sidebar-label className="flex items-baseline gap-1">
                <span className="font-display text-[17px] font-bold text-foreground">Meridian</span>
              </div>
            )}
          </Link>

          {/* Close button — mobile only */}
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/[0.04] hover:text-foreground transition-colors lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1 min-h-0 overflow-hidden py-4 px-2 vx-sidebar-scroll">
          <SidebarNav
            collapsed={collapsed}
            pathname={pathname}
            userRole={userRole}
            onNavClick={() => setSidebarOpen(false)}
          />
        </ScrollArea>

        {/* Footer — licence + collapse toggle */}
        <div data-sidebar-footer className={`flex items-center border-t border-black/[0.06] ${collapsed ? "flex-col gap-3 px-2 py-3" : "justify-between px-5 py-3"}`}>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${licenceDotColor} ${licencePulse}`} />
            {!collapsed && (
              <span data-sidebar-label className="text-[13px] text-muted-foreground">
                {licence?.valid === true ? "Licensed" : licence?.valid === false ? "Unlicensed" : "Checking…"}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={toggleCollapse}
            className="hidden lg:flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/[0.04] hover:text-foreground transition-colors"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="relative z-0 flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-black/[0.06] bg-[rgba(255,255,255,0.70)] backdrop-blur-xl px-4 sm:px-6">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-black/[0.04] hover:text-foreground transition-colors lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Search input */}
            <div className="hidden sm:flex items-center gap-2 rounded-xl bg-white/[0.60] border border-black/[0.08] px-3 py-2 flex-1 max-w-md focus-within:ring-1 focus-within:ring-primary focus-within:border-primary/40 transition-all">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                placeholder="Search modules, findings, records..."
                className="w-full bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Page title badge */}
            <span className="hidden md:inline-block text-sm font-medium text-muted-foreground truncate max-w-[160px]">
              {pageTitle}
            </span>

            {/* Export dropdown — downloads for the most recent completed version */}
            <HeaderExportMenu />

            <NotificationBell />
            <div className="ml-1">
              <UserButton />
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] p-4 sm:p-5 lg:p-6">
            {children}
          </div>
        </main>
      </div>

      {/* Ask Meridian — floating chat bubble + drawer */}
      <AskMeridian />
    </div>
  );

  return <AuthGuard>{content}</AuthGuard>;
}
