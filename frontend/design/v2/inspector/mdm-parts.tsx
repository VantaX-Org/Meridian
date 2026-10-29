"use client";

import type { ReactNode } from "react";

/** A labelled inspector section: the region's name is its heading, as in the rule inspector. */
export function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="m2-rsec" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** The facts list without a heading of its own: the section above names it. */
export function FactList({ children }: { children: ReactNode }) {
  return <dl className="m2-facts">{children}</dl>;
}
