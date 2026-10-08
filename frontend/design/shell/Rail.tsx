"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getShellCounts } from "../../lib/api/shell";
import { queryKeys } from "../../lib/query-keys";
import { Badge } from "../primitives/Badge";

const SECTIONS = [
  { href: "/home", label: "Home" },
  { href: "/objects", label: "Objects" },
  { href: "/runs", label: "Runs" },
  { href: "/fix", label: "Fix", countKey: "fix" as const },
  { href: "/inbox", label: "Inbox", countKey: "inbox" as const },
  { href: "/insights", label: "Insights" },
  { href: "/systems", label: "Systems" },
  { href: "/rules", label: "Rules" },
  { href: "/admin", label: "Admin" },
];

const RAIL_KEY = "meridian:rail";

export function Rail() {
  const pathname = usePathname();
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

  return (
    <nav
      style={{ width: expanded ? 240 : 56, background: "var(--m-sheet)", borderRight: "1px solid var(--m-line)" }}
      className="flex flex-col h-full"
    >
      <button type="button" onClick={toggle} aria-label="Toggle rail" className="p-3 text-left">
        {"☰"}
      </button>
      <ul className="flex flex-col gap-1 px-2">
        {SECTIONS.map((section) => {
          const count = section.countKey ? counts?.[section.countKey] ?? 0 : 0;
          const active = pathname.startsWith(section.href);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[13px]"
                style={{
                  color: active ? "var(--m-accent)" : "var(--m-ink)",
                  background: active ? "var(--m-accent-soft)" : "transparent",
                }}
              >
                {expanded ? section.label : section.label[0]}
                {expanded && count > 0 && <Badge count={count} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
