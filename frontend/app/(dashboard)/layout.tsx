"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
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
  Command as CommandIcon,
} from "lucide-react";
import { toast } from "sonner";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { downloadAuthenticated } from "@/lib/api/download";

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
            className="hidden sm:flex items-center gap-1.5 rounded-[8px] bg-[var(--mn-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--mn-primary-600)] transition-colors shadow-[0_0_12px_rgba(249,115,22,0.20)]"
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
          <DropdownMenuSeparator />


          <DropdownMenuItem
            disabled={!hasReport}
            onClick={async () => {
              if (!hasReport) return;
              const versionId = latestComplete!.id;
              try {
                await downloadAuthenticated(
                  getReportDownloadUrl(versionId),
                  `meridian_dq_report_${versionId}.pdf`,
                );
                toast.success("PDF report downloaded");
              } catch {
                toast.error("Failed to download PDF report — check your login and try again");
              }
            }}
            className="flex items-center gap-2 cursor-pointer"
          >
            <FileText className="h-4 w-4" />
            <span>Download PDF report</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            disabled={!hasReport}
            onClick={async () => {
              if (!hasReport) return;
              const versionId = latestComplete!.id;
              try {
                await downloadAuthenticated(
                  getReportJsonExportUrl(versionId),
                  `meridian_dq_report_${versionId}.json`,
                );
                toast.success("JSON report downloaded");
              } catch {
                toast.error("Failed to download JSON report — check your login and try again");
              }
            }}
          >
            <FileJson className="h-4 w-4" />
            <span>Download JSON report</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            disabled={!hasReport}
            onClick={async () => {
              if (!hasReport) return;
              const versionId = latestComplete!.id;
              try {
                await downloadAuthenticated(
                  getConfigMatchesExportUrl(versionId),
                  `meridian-config-${versionId.slice(0, 8)}.xlsx`,
                );
                toast.success("Config matches downloaded");
              } catch {
                toast.error("Failed to download config matches — check your login and try again");
              }
            }}
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
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import {
  type LucideIcon,
  Eraser,        // Cleaning — keep lucide for now
  ArrowLeftRight,// Migration — source→destination transfer
  Sliders,       // Settings sub-nav
  Map as MapIcon,// Settings sub-nav
} from "lucide-react";
import "@/app/sidebar-responsive.css";
import { MeridianMark } from "@/components/meridian/icons";
import {
  LayoutDashIcon,
  ClipboardIcon,
  WorkflowIcon,
  SettingsIcon,
  BarChartIcon,
  UploadIcon,
  AlertIcon,
  AnalyticsIcon,
  SparklesNavIcon,
  PlayIcon,
  FileTextIcon,
  GitCompareIcon,
  DatabaseIcon,
  BookIcon,
  ContractIcon,
  ServerIcon,
  PlugIcon,
  RefreshIcon,
} from "@/components/meridian/nav-icons";
import { useAuth } from "@/context/auth-context";
import { ForcePasswordChange } from "@/components/force-password-change";
import { UpdateAvailableModal } from "@/components/update-available-modal";
import { UpdateModalProvider } from "@/context/update-modal-context";
import { useRole } from "@/hooks/use-role";
import { useLicence } from "@/hooks/use-licence";
import { getUpdateStatus } from "@/lib/api/system-update";
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
  "/": "Overview",
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
  "/migration": "Migration",
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
  "/mining": "Mining",
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
    retry: false,
    meta: { ignoreError: true },
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
type NavIcon = LucideIcon | ((props: { size?: number; className?: string; style?: React.CSSProperties }) => React.JSX.Element);

interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  permission?: string;
  licenceKey?: string;
  badge?: number;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

// Roles permitted to review AI-proposed match rules — mirrors the
// review_ai_rules permission in api/services/rbac.py (admin, steward,
// ai_reviewer). Used to gate the Steward · AI Rules nav item.
const ROLES_WITH_AI_RULES = ["admin", "steward", "ai_reviewer"];

// Nav groups follow the Claude Design handoff (Aurora · Analyse · Report ·
// Steward · Govern · Connect · Settings) and use the bespoke per-item icon
// set from components/meridian/nav-icons.tsx.
const NAV_GROUPS: NavGroup[] = [
  {
    group: "Aurora",
    items: [
      { href: "/command-centre", label: "Command Centre", icon: LayoutDashIcon, licenceKey: "dashboard" },
      { href: "/workbench", label: "Workbench", icon: ClipboardIcon, licenceKey: "stewardship" },
      { href: "/process", label: "Process", icon: WorkflowIcon },
      { href: "/admin", label: "Admin", icon: SettingsIcon },
    ],
  },
  {
    group: "Analyse",
    items: [
      { href: "/", label: "Overview", icon: BarChartIcon, licenceKey: "dashboard" },
      { href: "/upload", label: "Import", icon: UploadIcon, licenceKey: "import" },
      { href: "/findings", label: "Findings", icon: AlertIcon, licenceKey: "findings" },
      { href: "/analytics", label: "Analytics", icon: AnalyticsIcon, licenceKey: "analytics" },
      { href: "/mining", label: "Mining", icon: SparklesNavIcon },
      { href: "/run-sync", label: "Run Sync", icon: PlayIcon, licenceKey: "sync" },
    ],
  },
  {
    group: "Report",
    items: [
      { href: "/reports", label: "Reports", icon: FileTextIcon, licenceKey: "reports" },
      { href: "/versions", label: "Versions", icon: GitCompareIcon, licenceKey: "versions" },
    ],
  },
  {
    group: "Steward",
    items: [
      { href: "/stewardship", label: "Workbench", icon: ClipboardIcon, licenceKey: "stewardship" },
      { href: "/ai/rules", label: "AI Rules", icon: SparklesNavIcon, permission: "review_ai_rules" },
      { href: "/exceptions", label: "Exceptions", icon: AlertIcon },
      { href: "/cleaning", label: "Cleaning", icon: Eraser },
      { href: "/migration", label: "Migration", icon: ArrowLeftRight },
      { href: "/dedup", label: "Dedup", icon: GitCompareIcon },
    ],
  },
  {
    group: "Govern",
    items: [
      { href: "/golden-records", label: "Golden Records", icon: DatabaseIcon },
      { href: "/glossary", label: "Glossary", icon: BookIcon },
      { href: "/contracts", label: "Contracts", icon: ContractIcon, licenceKey: "contracts" },
      { href: "/relationships", label: "Relationships", icon: WorkflowIcon },
    ],
  },
  {
    group: "Connect",
    items: [
      { href: "/systems", label: "Systems", icon: ServerIcon },
      { href: "/connectivity", label: "Connectivity", icon: PlugIcon },
      { href: "/sync", label: "Sync Monitor", icon: RefreshIcon },
      { href: "/config-impact", label: "Config Impact", icon: AlertIcon },
      { href: "/business-process", label: "Processes", icon: WorkflowIcon },
    ],
  },
];

// Settings sub-nav items (admin-only)
import { Key } from "lucide-react";

interface SettingsNavItem {
  href: string;
  label: string;
  icon: NavIcon;
  permission: string;
  licenceKey?: string;
}

const SETTINGS_SUB_NAV: SettingsNavItem[] = [
  { href: "/settings/rules", label: "Rules Engine", icon: Sliders, permission: "manage_rules", licenceKey: "rules_engine" },
  { href: "/settings/field-mapping", label: "Field Mapping", icon: MapIcon, permission: "manage_field_mappings", licenceKey: "field_mapping" },
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
  const { can, role } = useRole();
  const { isMenuItemEnabled } = useLicence();

  return (
    <nav className="flex flex-col gap-5">
      {NAV_GROUPS.map(({ group, items }) => {
        const visibleItems = items.filter((item) => {
          // Check licence: item must be enabled in manifest
          if (item.licenceKey && !isMenuItemEnabled(item.licenceKey)) return false;
          // Check permission: AI Rules is gated on review_ai_rules
          if (item.permission === "review_ai_rules" && !ROLES_WITH_AI_RULES.includes(role)) return false;
          if (item.permission && !can(item.permission)) return false;
          return true;
        });
        if (visibleItems.length === 0) return null;

        return (
          <div key={group}>
            {!collapsed && (
              <span
                data-sidebar-label
                className="mb-1.5 block px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--mn-ink-300)]"
              >
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
              {visibleItems.map((item) => {
                const { href, label, icon: Icon } = item;
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    data-sidebar-link
                    title={label}
                    onClick={onNavClick}
                    className={`group relative flex items-center gap-2.5 rounded-md transition-all duration-150 ${
                      collapsed ? "mx-auto h-10 w-10 justify-center" : "mx-1 px-3 py-[7px]"
                    } ${
                      active
                        ? "bg-[var(--mn-primary-50)] text-[var(--mn-primary-700)] font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2.5px] before:rounded-r-full before:bg-[var(--mn-primary)]"
                        : "text-[var(--mn-ink-500)] hover:bg-black/[0.04] hover:text-[var(--mn-ink-900)]"
                    }`}
                  >
                    <Icon data-sidebar-icon size={collapsed ? 20 : 16} className="shrink-0" />
                    {!collapsed && (
                      <span data-sidebar-label className="flex-1 text-[13px] font-medium truncate">{label}</span>
                    )}
                    {!collapsed && item.badge != null && (
                      <span
                        data-sidebar-label
                        className="px-[6px] py-[1px] rounded-full bg-[var(--mn-neg-bg)] text-[var(--mn-neg)] text-[10.5px] font-bold tabular-nums"
                      >
                        {item.badge}
                      </span>
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
          className={`group relative flex items-center gap-3 rounded-lg transition-all duration-150 ${
            collapsed
              ? "mx-auto h-10 w-10 justify-center"
              : "mx-1 px-3 py-2"
          } ${
            pathname === "/settings"
              ? "bg-primary/[0.08] text-primary font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-primary"
              : "text-[#6B7280] hover:bg-black/[0.04] hover:text-foreground"
          }`}
        >
          <SettingsIcon size={collapsed ? 20 : 18} className="shrink-0" />
          {!collapsed && <span data-sidebar-label className="text-[13px] font-medium">Settings</span>}
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
                    className={`group relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[12.5px] transition-all duration-150 ${
                      active
                        ? "bg-[var(--mn-primary-50)] text-[var(--mn-primary-700)] font-semibold before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:rounded-r-full before:bg-[var(--mn-primary)]"
                        : "text-[var(--mn-ink-500)] hover:bg-black/[0.04] hover:text-[var(--mn-ink-900)]"
                    }`}
                  >
                    <Icon className="h-[14px] w-[14px] shrink-0" />
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
  const { user, isLoading, mustChangePassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/sign-in");
    }
  }, [isLoading, user, router]);

  // Force password change before any dashboard UI renders. Blocking
  // overlay; user can explicitly sign out from inside it.
  if (user && mustChangePassword) {
    return <ForcePasswordChange />;
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!user) return null;
  return (
    <UpdateModalProvider>
      {children}
      <UpdateAvailableModal />
    </UpdateModalProvider>
  );
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

  // Sidebar footer version badge. `/system/update-status` is admin-only
  // (403 for everyone else), so this is only enabled for admins — the
  // shared ["system-update-status"] query key means it's the same
  // in-flight/cached request the update-available modal and Admin page
  // already use, not an extra network round trip on top of theirs. Other
  // roles keep the static fallback below.
  const { user: currentUser } = useAuth();
  const { data: updateStatus } = useQuery({
    queryKey: ["system-update-status"],
    queryFn: getUpdateStatus,
    enabled: currentUser?.role === "admin",
    staleTime: 5 * 60_000,
    retry: false,
  });
  const versionLabel = updateStatus?.current_version
    ? updateStatus.current_version.startsWith("v")
      ? updateStatus.current_version
      : `v${updateStatus.current_version}`
    : "v4.2";

  const licence = health?.licence;
  const licenceDotColor =
    licence?.valid === true
      ? "bg-[#256F3A]"
      : licence?.valid === false
        ? "bg-destructive"
        : "bg-muted-foreground";
  const licencePulse = licence?.valid === true ? "animate-[vx-pulse-dot_2s_ease-in-out_infinite]" : "";

  const { role: userRole } = useRole();
  const pageTitle = getPageTitle(pathname);
  const { open: cmdkOpen, setOpen: setCmdkOpen } = useCommandPalette();
  const breadcrumbItems = useMemo(() => {
    const items: { label: string; href?: string }[] = [{ label: "Home", href: "/" }];
    const segments = pathname.split("/").filter(Boolean);
    let acc = "";
    segments.forEach((seg) => {
      acc += `/${seg}`;
      const label = PAGE_TITLES[acc] ?? seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      items.push({ label, href: acc });
    });
    return items;
  }, [pathname]);

  const content = (
    <div className="flex h-screen overflow-hidden mn-surface">
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
        onClick={(e) => {
          // Belt-and-braces: close the mobile sidebar on any anchor click
          // anywhere inside the nav. Individual Link onClicks already call
          // setSidebarOpen(false), but if any entry ever forgets the
          // callback this catches it. No-op on desktop (lg: breakpoint).
          const target = e.target as HTMLElement;
          if (target.closest("a[href]")) {
            setSidebarOpen(false);
          }
        }}
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-white border-r border-[var(--mn-line)] transition-all duration-300 ease-in-out lg:relative lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${
          collapsed ? "lg:w-[72px]" : "lg:w-[260px]"
        } w-[280px]`}
      >
        {/* Logo */}
        <div data-sidebar-header className={`flex h-16 shrink-0 items-center border-b border-black/[0.06] ${collapsed ? "justify-center px-2" : "justify-between px-5"}`}>
          <Link href="/" onClick={() => setSidebarOpen(false)} className="flex flex-1 items-center gap-2.5">
            <MeridianMark size={28} style={{ color: "var(--mn-primary)" }} />
            {!collapsed && (
              <>
                <div data-sidebar-label className="flex flex-col gap-0.5">
                  <span className="font-display text-[15.5px] font-bold tracking-[-0.025em] text-foreground leading-none">
                    Meridian
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground leading-none">
                    Data Quality
                  </span>
                </div>
                <span
                  data-sidebar-label
                  className="ml-auto font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--mn-ink-300)] px-1.5 py-0.5 border border-[var(--mn-line)] rounded"
                >
                  {versionLabel}
                </span>
              </>
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
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--mn-line)] bg-white px-4 sm:px-6">
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

            {/* Command palette trigger */}
            <button
              type="button"
              onClick={() => setCmdkOpen(true)}
              title="Open command palette (⌘K)"
              className="group hidden sm:flex items-center gap-2 rounded-[8px] bg-white border border-border px-3 py-2 flex-1 max-w-md text-left transition-all hover:border-primary/40 hover:shadow-[0_0_0_3px_rgba(249,115,22,0.08)]"
            >
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate text-sm text-muted-foreground">
                Jump to anything…
              </span>
              <kbd className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                <CommandIcon className="h-2.5 w-2.5" aria-hidden />
                K
              </kbd>
            </button>

            <div className="hidden lg:block min-w-0 flex-1">
              <Breadcrumb items={breadcrumbItems} className="ml-1" />
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
          <div className="mx-auto max-w-[1640px] px-5 pt-5 pb-14 sm:px-7">
            {children}
          </div>
        </main>
      </div>

      {/* Command palette (⌘K) */}
      <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />
    </div>
  );

  return <AuthGuard>{content}</AuthGuard>;
}
