"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getShellCounts } from "../../lib/api/shell";
import { queryKeys } from "../../lib/query-keys";
import { useVisibleNav } from "../../hooks/use-nav";
import { flattenNav, type NavItem } from "../../lib/nav";
import { Badge } from "../primitives/Badge";

const RAIL_KEY = "meridian:rail";

/** Nav items whose badge comes from the live shell counts, by href. */
const COUNT_KEY: Record<string, "fix" | "inbox"> = {
  "/fix": "fix",
  "/cleaning": "fix",
  "/inbox": "inbox",
};

export function Rail() {
  const pathname = usePathname();
  const groups = useVisibleNav();
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage after mount
    if (window.localStorage.getItem(RAIL_KEY) === "collapsed") setExpanded(false);
  }, []);
  const { data: counts } = useQuery({ queryKey: queryKeys.shellCounts(), queryFn: getShellCounts });

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    window.localStorage.setItem(RAIL_KEY, next ? "expanded" : "collapsed");
  };

  const renderItem = (item: NavItem) => {
    const countKey = COUNT_KEY[item.href];
    const count = countKey ? counts?.[countKey] ?? 0 : 0;
    const itemPath = item.href.split("?")[0];
    const active = pathname === itemPath || pathname.startsWith(itemPath + "/");
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          title={item.label}
          aria-label={item.label}
          aria-current={active ? "page" : undefined}
          className="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[13px]"
          style={{
            color: active ? "var(--m-accent)" : "var(--m-ink)",
            background: active ? "var(--m-accent-soft)" : "transparent",
          }}
        >
          {expanded ? item.label : item.label[0]}
          {expanded && count > 0 && <Badge count={count} />}
        </Link>
      </li>
    );
  };

  return (
    <nav
      style={{ width: expanded ? 240 : 56, background: "var(--m-sheet)", borderRight: "1px solid var(--m-line)" }}
      className="flex flex-col h-full overflow-y-auto"
    >
      <button type="button" onClick={toggle} aria-label="Toggle rail" className="p-3 text-left">
        {"☰"}
      </button>
      {groups.map((group) => (
        <div key={group.group} className="flex flex-col gap-1 px-2 mb-2">
          {expanded && (
            <p className="px-2 text-[11px]" style={{ color: "var(--m-ink-3)" }}>
              {group.group}
            </p>
          )}
          <ul className="flex flex-col gap-1">{flattenNav(group.items).map(renderItem)}</ul>
        </div>
      ))}
    </nav>
  );
}
