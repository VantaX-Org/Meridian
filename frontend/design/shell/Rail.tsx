"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getShellCounts } from "../../lib/api/shell";
import { getSystems } from "../../lib/api/connectivity";
import { queryKeys } from "../../lib/query-keys";
import { useNavLoading, useVisibleNav } from "../../hooks/use-nav";
import { useRole } from "../../hooks/use-role";
import { MeridianMark } from "../icons/Mark";
import { IconChevronDown } from "../icons";
import { activeHref, flattenNav, resolveNavHref, splitNav, type NavItem } from "../../lib/nav";
import { Badge } from "../primitives/Badge";
import { Skeleton } from "../primitives/Skeleton";

/**
 * The index bar: the product's top row. The brand, the four places everyone works from (Fix work, Objects,
 * Progress, Inbox: lib/nav.ts's main group) as one pill strip with live counts, a "More" menu holding every
 * other visible page under its section (Analysis, Master data, Rules, Data in, Admin), and the shell's controls
 * on the right (search, jobs, notifications, help, the user). There is no sidebar, collapsed state or flyout.
 * Links never carry `?run=`: each section opens on its own latest run (lib/run-scope.ts).
 */

const MORE_PANEL_ID = "topnav-more";
const ICON_SIZE = 16;

/** Worst system health across all connected systems, for the Systems item's pip. Null when there are no systems at all. */
function worstHealth(systems: readonly { health_status: string }[] | undefined): "critical" | "high" | "pass" | null {
  if (!systems?.length) return null;
  if (systems.some((s) => s.health_status === "unreachable" || s.health_status === "auth_failed")) return "critical";
  if (systems.some((s) => s.health_status === "degraded")) return "high";
  return "pass";
}

const HEALTH_PIP_COLOR: Record<"critical" | "high" | "pass", string> = {
  critical: "var(--m-critical)",
  high: "var(--m-high)",
  pass: "var(--m-pass)",
};

export interface RailProps {
  commandPalette?: ReactNode;
  notifications?: ReactNode;
  helpMenu?: ReactNode;
  userMenu?: ReactNode;
}

export function Rail({ commandPalette, notifications, helpMenu, userMenu }: RailProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const groups = useVisibleNav();
  const navLoading = useNavLoading();
  const { role } = useRole();
  const moreRef = useRef<HTMLLIElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const { data: counts } = useQuery({ queryKey: queryKeys.shellCounts(), queryFn: getShellCounts, refetchInterval: 60_000 });
  const { data: systems } = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const healthTone = worstHealth(systems);
  const healthLabel = systems?.length
    ? `${systems.filter((s) => s.health_status !== "unreachable" && s.health_status !== "auth_failed" && s.health_status !== "degraded").length} of ${systems.length} systems healthy`
    : undefined;

  const flatItems = useMemo(() => flattenNav(groups.flatMap((g) => g.items)), [groups]);
  const activeItemHref = useMemo(
    () => activeHref(pathname ?? "", searchParams ?? new URLSearchParams(), flatItems),
    [pathname, searchParams, flatItems],
  );

  const { main: primaryItems, more } = useMemo(() => splitNav(groups, (href) => resolveNavHref(href, role)), [groups, role]);
  const moreActive = more.some((g) => g.items.some((i) => i.href === activeItemHref));

  // The panel closes on Escape, on a click outside it and when focus leaves it.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    const onClick = (e: globalThis.MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [moreOpen]);

  const isActive = (item: NavItem) => item.href === activeItemHref || !!item.children?.some((c) => c.href === activeItemHref);

  const hasPip = (item: NavItem) => item.href === "/systems" && healthTone !== null;
  const renderIcon = (item: NavItem) => (
    <span className="relative inline-flex shrink-0">
      <item.icon size={ICON_SIZE} />
      {hasPip(item) && healthTone && (
        <span
          aria-hidden="true"
          className="absolute rounded-full"
          style={{ width: 6, height: 6, top: -2, right: -2, background: HEALTH_PIP_COLOR[healthTone], border: "1.5px solid var(--m-sheet)" }}
        />
      )}
    </span>
  );

  const renderPill = (item: NavItem) => {
    const active = isActive(item);
    const count = item.badgeKey ? counts?.[item.badgeKey] ?? 0 : 0;
    const showPip = hasPip(item);
    return (
      <li key={item.href}>
        <Link
          href={resolveNavHref(item.href, role)}
          aria-current={active ? "page" : undefined}
          aria-label={showPip && healthLabel ? `${item.label}, ${healthLabel}` : undefined}
          className="m-topnav-link"
        >
          {renderIcon(item)}
          <span>{item.label}</span>
          {count > 0 && (
            <span key={count} className="m-motion-rise" data-severity={item.badgeKey === "fix" ? "critical" : undefined}>
              <Badge count={count} tone={item.badgeKey === "fix" ? "critical" : undefined} />
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <header className="m-topnav m-print-hide" data-tour="rail">
      <Link href={resolveNavHref("/home/lead", role)} aria-label="Meridian" className="m-topnav-brand">
        <MeridianMark size={24} variant="two-tone" aria-hidden />
        <span className="hidden sm:inline">Meridian</span>
      </Link>

      <nav aria-label="Main" className="m-topnav-nav">
        {/* Waits for /me/permissions: showing the anyOf-only nav first would flash items the grants then hide. */}
        {navLoading ? (
          <div className="flex items-center gap-2" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} width={84} height={28} />)}
          </div>
        ) : (
          <ul data-testid="rail-nav-items" className="m-topnav-list">
            {primaryItems.map(renderPill)}
            {more.length > 0 && (
              <li ref={moreRef} className="relative">
                <button
                  ref={moreButtonRef}
                  type="button"
                  className="m-topnav-link"
                  data-active={moreActive || undefined}
                  aria-expanded={moreOpen}
                  aria-controls={MORE_PANEL_ID}
                  onClick={() => setMoreOpen((o) => !o)}
                >
                  <span>More</span>
                  <IconChevronDown size={14} style={{ transform: moreOpen ? "rotate(180deg)" : undefined }} />
                </button>
                {moreOpen && (
                  <div
                    id={MORE_PANEL_ID}
                    role="group"
                    aria-label="More pages"
                    className="m-topnav-more m-elev-2 m-motion-scale-in"
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget !== moreButtonRef.current) setMoreOpen(false);
                    }}
                  >
                    {more.map((g) => (
                      <div key={g.group} className="m-topnav-group">
                        <span className="m-topnav-group-label">{g.group}</span>
                        {g.items.map((item) => (
                          <Link
                            key={item.href}
                            href={resolveNavHref(item.href, role)}
                            aria-current={item.href === activeItemHref ? "page" : undefined}
                            aria-label={hasPip(item) && healthLabel ? `${item.label}, ${healthLabel}` : undefined}
                            className="m-topnav-item"
                            onClick={() => setMoreOpen(false)}
                          >
                            {renderIcon(item)}
                            <span className="truncate">{item.label}</span>
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )}
          </ul>
        )}
      </nav>

      <div className="m-topnav-right">
        <div data-tour="command-palette" className="flex items-center">{commandPalette}</div>
        {notifications}
        {helpMenu}
        {userMenu}
      </div>
    </header>
  );
}
