"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { HUB_ROUTES, locate, tabHref, type Workspace } from "@/lib/workspaces";

/** The four stages a steward walks through, in order; Home sits above, Admin below. */
const STAGES = new Set(["data", "analyse", "workbench", "process"]);

/**
 * Labelled sidebar: each workspace with what it is for, and the open one
 * expanded to its tabs. Stages are numbered because they are a sequence.
 */
export function JourneyNav({ workspaces, icons }: {
  workspaces: Workspace[];
  icons: Record<string, React.ReactNode>;
}) {
  const pathname = usePathname();
  const tabParam = useSearchParams().get("tab");
  const here = locate(pathname);
  const activeTab = HUB_ROUTES.has(pathname)
    ? here?.workspace.tabs.find((t) => t.id === tabParam) ?? here?.workspace.tabs.find((t) => !t.hidden)
    : here?.tab;

  let n = 0;
  const row = (w: Workspace) => {
    const open = here?.workspace.id === w.id;
    const step = STAGES.has(w.id) ? ++n : null;
    return (
      <li key={w.id} className="mn-journey__item" data-open={open || undefined}>
        <Link href={w.href} className="mn-journey__ws aurora-focus-ring" aria-current={open && !activeTab ? "page" : undefined}
              title={`${w.label}: ${w.hint} (${w.shortcut})`}>
          <span className="mn-journey__icon" aria-hidden>{icons[w.id]}</span>
          <span className="mn-journey__text">
            <span className="mn-journey__label">{step ? <span className="mn-journey__step">{step}</span> : null}{w.label}</span>
            <span className="mn-journey__hint">{w.hint}</span>
          </span>
        </Link>
        {open ? (
          <ul className="mn-journey__tabs">
            {w.tabs.filter((t) => !t.hidden).map((t) => (
              <li key={t.id}>
                <Link href={tabHref(w, t)} className="mn-journey__tab aurora-focus-ring"
                      aria-current={activeTab?.id === t.id ? "page" : undefined}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  };

  const home = workspaces.filter((w) => w.id === "command-centre");
  const stages = workspaces.filter((w) => STAGES.has(w.id));
  const rest = workspaces.filter((w) => w.id !== "command-centre" && !STAGES.has(w.id));
  return (
    <nav className="mn-journey" aria-label="Workspaces">
      <ul>{home.map(row)}</ul>
      <ul className="mn-journey__stages">{stages.map(row)}</ul>
      <ul className="mn-journey__foot">{rest.map(row)}</ul>
    </nav>
  );
}
