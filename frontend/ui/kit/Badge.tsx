import type { ReactNode } from "react";

/** A small count or state beside a label (tab counts, nav counts). Text only, so it never relies on colour. */
export function Badge({ children, tone }: { children: ReactNode; tone?: "good" | "bad" }) {
  return <span className="mx-badge" data-tone={tone}>{children}</span>;
}
