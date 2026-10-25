"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getShellCounts } from "../../lib/api/shell";
import { getSystems } from "../../lib/api/connectivity";
import { queryKeys } from "../../lib/query-keys";
import { useNavLoading, useVisibleNav } from "../../hooks/use-nav";
import { useRole } from "../../hooks/use-role";
import { personaForRole, type Persona } from "../../lib/persona";
import { MeridianMark } from "../icons/Mark";
import { IconChevronDown } from "../icons";
import { activeHref, flattenNav, resolveNavHref, splitNav, type NavGroup, type NavItem } from "../../lib/nav";
import { Badge } from "../primitives/Badge";
import { Skeleton } from "../primitives/Skeleton";

/**
 * The index bar: the product's top row. The brand, the four places everyone works from (Fix work, Objects,
 * Progress, Inbox: lib/nav.ts's main group) as one pill strip with live counts, a "More" menu holding every
 * other visible page under its section (Analysis, Master data, Rules, Data in, Admin), and the shell's controls
 * on the right (search, jobs, notifications, help, the user). There is no sidebar, collapsed state or flyout.
 * Links never carry `?run=`: each section opens on its own latest run (lib/run-scope.ts).
 * The process persona's strip swaps Fix work for Processes (`railSplit`): its day is the catalogue, not the fix queue.
 */

/** The pill label where the nav label is too long for the strip. */
const PILL_LABEL: Record<string, string> = { "/process": "Processes" };
/** Items whose children are tabs of the item's own page, so the More panel lists the item once and not its tabs. */
const FOLDED = new Set(["/admin/settings"]);
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

type MoreGroup = { group: string; items: NavItem[] };

/**
 * The pills and the More panel for one persona: main's split (lib/nav.ts `splitNav`), then two adjustments.
 * A folded item (Settings) stands for its tabs, so its children leave the panel. The process persona's day is
 * the catalogue, not the fix queue: its strip swaps Fix work for As-is processes (labelled Processes), still
 * four pills, and Fix work moves to the top of More.
 */
export function railSplit(
  groups: readonly NavGroup[],
  persona: Persona,
  resolve: (href: string) => string = (h) => h,
): { main: NavItem[]; more: MoreGroup[] } {
  const split = splitNav(groups, resolve);
  const folded = new Set(
    flattenNav(groups.flatMap((g) => g.items))
      .filter((i) => FOLDED.has(i.href))
      .flatMap((i) => (i.children ?? []).map((c) => c.href)),
  );
  let main = split.main;
  let more: MoreGroup[] = split.more.map((g) => ({ group: g.group, items: g.items.filter((i) => !folded.has(i.href)) }));
  const processItem = persona === "process" ? groups.flatMap((g) => g.items).find((i) => i.href === "/process") : undefined;
  if (processItem) {
    const fixIndex = main.findIndex((i) => i.href === "/fix");
    const fixItem = fixIndex >= 0 ? main[fixIndex] : undefined;
    main = fixItem ? main.map((i, n) => (n === fixIndex ? processItem : i)) : [processItem, ...main];
    more = more.map((g) => ({ group: g.group, items: g.items.filter((i) => i.href !== "/process") }));
    if (fixItem) {
      const [first, ...rest] = more;
      more = first ? [{ group: first.group, items: [fixItem, ...first.items] }, ...rest] : [{ group: "Work", items: [fixItem] }];
    }
  }
  return { main, more: more.filter((g) => g.items.length > 0) };
}

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
  const { homeRole: role } = useRole();
  const moreRef = useRef<HTMLLIElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // The panel is fixed to the viewport under the More button: the pill strip scrolls sideways (overflow-x), which
  // would clip anything positioned inside it, so the panel renders outside the strip and is anchored by coordinates.
  const [moreAnchor, setMoreAnchor] = useState<{ top: number; left: number } | null>(null);

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

  const { main: primaryItems, more } = useMemo(
    () => railSplit(groups, personaForRole(role), (href) => resolveNavHref(href, role)),
    [groups, role],
  );
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
      const target = e.target as Node;
      if (!moreRef.current?.contains(target) && !morePanelRef.current?.contains(target)) setMoreOpen(false);
    };
    const place = () => {
      const rect = moreButtonRef.current?.getBoundingClientRect();
      if (rect) setMoreAnchor({ top: rect.bottom + 8, left: rect.left });
    };
    place();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
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
          // With a health pip the name starts with the visible pill text and keeps the badge count, then the health.
          aria-label={showPip && healthLabel ? `${PILL_LABEL[item.href] ?? item.label}${count > 0 ? ` ${count > 99 ? "99+" : count}` : ""}, ${healthLabel}` : undefined}
          className="m-topnav-link"
        >
          {renderIcon(item)}
          <span>{PILL_LABEL[item.href] ?? item.label}</span>
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
              </li>
            )}
          </ul>
        )}
      </nav>
      {/* Outside the nav: the pill strip scrolls sideways and would clip the panel. */}
      {moreOpen && more.length > 0 && (
        <div
          ref={morePanelRef}
          id={MORE_PANEL_ID}
          role="group"
          aria-label="More pages"
          className="m-topnav-more m-elev-2 m-motion-scale-in"
          data-testid="topnav-more-panel"
          style={moreAnchor ? ({ "--rail-more-top": `${moreAnchor.top}px`, "--rail-more-left": `${moreAnchor.left}px` } as CSSProperties) : undefined}
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

      <div className="m-topnav-right">
        <div data-tour="command-palette" className="flex items-center">{commandPalette}</div>
        {notifications}
        {helpMenu}
        {userMenu}
      </div>
    </header>
  );
}
