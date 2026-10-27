import { Fragment, type ReactNode } from "react";

/**
 * An identifier-like name ("quality_management_1k") that may wrap only after an underscore, never inside a word: a
 * `<wbr>` after each "_" (hyphens and spaces already break). Render it inside `BREAK_AT_SEPARATORS` so a parent's
 * `overflow-wrap: anywhere` cannot split a word. `wbrClassName` hides the breaks where the name must stay on one line
 * (Chrome breaks at a `<wbr>` even under `white-space: nowrap`; a hidden one is no break).
 */
export function breakAtUnderscores(name: string, wbrClassName?: string): ReactNode {
  const parts = name.split("_");
  return parts.map((p, i) => (i < parts.length - 1 ? <Fragment key={i}>{p}_<wbr className={wbrClassName} /></Fragment> : <Fragment key={i}>{p}</Fragment>));
}

/** Classes for the element holding a `breakAtUnderscores` name: words stay whole; lines break at the separators only. */
export const BREAK_AT_SEPARATORS = "[overflow-wrap:normal] [word-break:normal] [hyphens:none]";
