"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { getShellCounts } from "../../lib/api/shell";
import { getSystems } from "../../lib/api/connectivity";
import { queryKeys } from "../../lib/query-keys";
import { useVisibleNav } from "../../hooks/use-nav";
import { useRole } from "../../hooks/use-role";
import { activeHref, flattenNav, homeHrefForRole, type NavItem } from "../../lib/nav";
import { mMotion } from "../tokens";
import { Badge } from "../primitives/Badge";
import { Tooltip } from "../primitives/Tooltip";

const RAIL_KEY = "meridian:rail";
const RAIL_WIDTH_EXPANDED = 240;
const RAIL_WIDTH_COLLAPSED = 56;
const ICON_SIZE = 20;

/** Worst system health across all connected systems, for the Systems item's pip. None when nothing needs attention. */
function worstHealth(systems: readonly { health_status: string }[] | undefined): "critical" | "medium" | null {
  if (!systems?.length) return null;
  if (systems.some((s) => s.health_status === "unreachable" || s.health_status === "auth_failed")) return "critical";
  if (systems.some((s) => s.health_status === "degraded")) return "medium";
  return null;
}

function HealthPip({ tone }: { tone: "critical" | "medium" }) {
  return (
    <span
      aria-hidden="true"
      className="absolute rounded-full"
      style={{
        width: 7,
        height: 7,
        top: -2,
        right: -2,
        background: tone === "critical" ? "var(--m-critical)" : "var(--m-medium)",
        border: "1.5px solid var(--m-sheet)",
      }}
    />
  );
}

/** Flat, in-render-order list of hrefs: top-level items, then each expanded parent's children. */
function visibleOrder(items: readonly NavItem[], openParents: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const item of items) {
    out.push(item.href);
    if (item.children?.length && openParents.has(item.href)) {
      for (const child of item.children) out.push(child.href);
    }
  }
  return out;
}

export function Rail() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const groups = useVisibleNav();
  const { role } = useRole();
  const navRef = useRef<HTMLElement>(null);
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());

  const [expanded, setExpanded] = useState(true);
  const [openParents, setOpenParents] = useState<Set<string>>(new Set());
  const [flyoutHref, setFlyoutHref] = useState<string | null>(null);
  const [flyoutRect, setFlyoutRect] = useState<{ top: number; left: number } | null>(null);
  const flyoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: counts } = useQuery({ queryKey: queryKeys.shellCounts(), queryFn: getShellCounts });
  const { data: systems } = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const healthTone = worstHealth(systems);

  const flatItems = useMemo(() => flattenNav(groups.flatMap((g) => g.items)), [groups]);
  const activeItemHref = useMemo(
    () => activeHref(pathname ?? "", searchParams ?? new URLSearchParams(), flatItems),
    [pathname, searchParams, flatItems],
  );

  // Auto-open any parent whose child is the active item, so the active row is always visible.
  useEffect(() => {
    const parent = groups.flatMap((g) => g.items).find((i) => i.children?.some((c) => c.href === activeItemHref));
    if (parent) setOpenParents((prev) => (prev.has(parent.href) ? prev : new Set(prev).add(parent.href)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the active item actually changes
  }, [activeItemHref]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage after mount
    if (window.localStorage.getItem(RAIL_KEY) === "collapsed") setExpanded(false);
  }, []);

  // "[" toggles the rail, like a shortcut — ignored while typing or with a modifier held.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      toggle();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggle closes over current `expanded` via its own state setter
  }, []);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      window.localStorage.setItem(RAIL_KEY, next ? "expanded" : "collapsed");
      return next;
    });
    closeFlyout();
  };

  const toggleParent = (href: string) => {
    setOpenParents((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  };

  const openFlyout = (href: string, el: HTMLElement) => {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
    flyoutTimer.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      setFlyoutRect({ top: rect.top, left: rect.right + 8 });
      setFlyoutHref(href);
    }, mMotion.duration);
  };

  const closeFlyout = () => {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
    flyoutTimer.current = setTimeout(() => setFlyoutHref(null), mMotion.duration);
  };

  const order = useMemo(() => visibleOrder(flatTopLevel(groups), openParents), [groups, openParents]);
  const [focusedHref, setFocusedHref] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keeps the roving-tabindex cursor valid as the active route changes
    if (activeItemHref && order.includes(activeItemHref)) setFocusedHref(activeItemHref);
  }, [activeItemHref, order]);

  const moveFocus = (fromHref: string, delta: 1 | -1) => {
    const i = order.indexOf(fromHref);
    if (i === -1) return;
    const nextHref = order[(i + delta + order.length) % order.length];
    if (!nextHref) return;
    setFocusedHref(nextHref);
    linkRefs.current.get(nextHref)?.focus();
  };

  const onItemKeyDown = (item: NavItem, e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(item.href, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(item.href, -1);
    } else if (e.key === "ArrowRight" && item.children?.length) {
      e.preventDefault();
      if (expanded) setOpenParents((prev) => new Set(prev).add(item.href));
      else openFlyout(item.href, e.currentTarget);
    } else if (e.key === "ArrowLeft" && item.children?.length && openParents.has(item.href)) {
      e.preventDefault();
      setOpenParents((prev) => {
        const next = new Set(prev);
        next.delete(item.href);
        return next;
      });
    }
  };

  const renderRow = (item: NavItem, depth: 0 | 1) => {
    const linkHref = item.href.startsWith("/home/") ? homeHrefForRole(role) : item.href;
    const active = item.href === activeItemHref;
    const count = item.badgeKey ? counts?.[item.badgeKey] ?? 0 : 0;
    const hasChildren = depth === 0 && !!item.children?.length;
    const isOpen = openParents.has(item.href);
    const showPip = item.href === "/systems" && healthTone !== null;
    const label = (
      <>
        <span className="relative inline-flex shrink-0" style={{ color: active ? "var(--m-accent)" : "var(--m-ink-2)" }}>
          <item.icon size={ICON_SIZE} />
          {showPip && healthTone && <HealthPip tone={healthTone} />}
        </span>
        {expanded && <span className="flex-1 truncate">{item.label}</span>}
        {expanded && count > 0 && (
          <span key={count} className="m-motion-rise">
            <Badge count={count} />
          </span>
        )}
        {expanded && hasChildren && (
          <ChevronRight
            size={14}
            className="m-motion-fade"
            style={{ color: "var(--m-ink-3)", transform: isOpen ? "rotate(90deg)" : "none" }}
          />
        )}
      </>
    );

    const row = (
      <Link
        ref={(el) => {
          if (el) linkRefs.current.set(item.href, el);
          else linkRefs.current.delete(item.href);
        }}
        key={item.href}
        href={linkHref}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        tabIndex={item.href === (focusedHref ?? order[0]) ? 0 : -1}
        onFocus={() => setFocusedHref(item.href)}
        onKeyDown={(e) => onItemKeyDown(item, e)}
        onClick={(e: ReactMouseEvent<HTMLAnchorElement>) => {
          if (hasChildren && expanded) {
            e.preventDefault();
            toggleParent(item.href);
          }
        }}
        onMouseEnter={(e) => {
          if (!expanded) openFlyout(item.href, e.currentTarget);
        }}
        onMouseLeave={closeFlyout}
        className="m-motion-fade group flex items-center gap-2 rounded px-2 border-l-2"
        style={{
          height: depth === 0 ? 32 : 28,
          marginLeft: expanded && depth === 1 ? 20 : 0,
          color: active ? "var(--m-accent)" : "var(--m-ink)",
          background: active ? "var(--m-accent-soft)" : "transparent",
          borderLeftColor: active ? "var(--m-accent)" : "transparent",
          justifyContent: expanded ? "flex-start" : "center",
        }}
      >
        {label}
      </Link>
    );

    if (expanded) {
      return (
        <li key={item.href}>
          {row}
          {hasChildren && isOpen && (
            <ul className="m-motion-fade flex flex-col gap-0.5 mt-0.5">
              {item.children!.map((child) => (
                <li key={child.href}>{renderRow(child, 1)}</li>
              ))}
            </ul>
          )}
        </li>
      );
    }

    // Collapsed: a child-less item gets a simple right-side tooltip; a parent gets the hover/focus flyout below.
    return (
      <li key={item.href} className="relative">
        {hasChildren ? row : <Tooltip label={item.label} side="right">{row}</Tooltip>}
      </li>
    );
  };

  const flyoutItem = flyoutHref ? flatTopLevel(groups).find((i) => i.href === flyoutHref) : null;

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      className="m-motion-width flex flex-col h-full overflow-y-auto shrink-0"
      style={{ width: expanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED, background: "var(--m-sheet)", borderRight: "1px solid var(--m-line)" }}
    >
      <div className="flex items-center h-12 px-3 font-semibold" style={{ color: "var(--m-ink)" }}>
        {expanded ? "Meridian" : "M"}
      </div>

      <div className="flex-1 flex flex-col gap-3 px-2 py-2">
        {groups.map((group) => (
          <div key={group.group} className="flex flex-col gap-0.5">
            {expanded && (
              <p className="px-2 mb-0.5 text-[11px]" style={{ color: "var(--m-ink-3)" }}>
                {group.group}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">{group.items.map((item) => renderRow(item, 0))}</ul>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
        className="flex items-center gap-2 h-10 px-3 border-t"
        style={{ borderColor: "var(--m-line)", color: "var(--m-ink-2)" }}
      >
        {expanded ? <PanelLeftClose size={ICON_SIZE} /> : <PanelLeftOpen size={ICON_SIZE} />}
        {expanded && <span className="text-[12px]">Collapse</span>}
      </button>

      {!expanded && flyoutItem && flyoutRect && (
        <div
          role="menu"
          aria-label={flyoutItem.label}
          onMouseEnter={() => flyoutTimer.current && clearTimeout(flyoutTimer.current)}
          onMouseLeave={closeFlyout}
          className="m-motion-fade fixed z-50 rounded border shadow-sm py-1 min-w-[200px]"
          style={{ top: flyoutRect.top, left: flyoutRect.left, borderColor: "var(--m-line)", background: "var(--m-sheet)" }}
        >
          <p className="px-3 py-1 text-[11px]" style={{ color: "var(--m-ink-3)" }}>
            {flyoutItem.label}
          </p>
          {(flyoutItem.children?.length ? flyoutItem.children : [flyoutItem]).map((child) => (
            <Link
              key={child.href}
              href={child.href.startsWith("/home/") ? homeHrefForRole(role) : child.href}
              role="menuitem"
              className="block px-3 py-1.5 text-[13px]"
              style={{ color: child.href === activeItemHref ? "var(--m-accent)" : "var(--m-ink)" }}
            >
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

function flatTopLevel(groups: readonly { items: readonly NavItem[] }[]): NavItem[] {
  return groups.flatMap((g) => g.items);
}
