"use client";

// frontend/design/templates/NextActions.tsx
import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { Button } from "../primitives/Button";

export interface NextAction {
  id: string;
  title: string;
  impact?: string[];
  verb: string;
  href?: string;
  onClick?: () => void;
  /** Plain-language reason this ranks here. */
  why: string;
}

export function NextActions({ actions }: { actions: NextAction[] }) {
  const shown = actions.slice(0, 5);
  if (shown.length === 0) {
    return <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>Nothing to do yet. Actions appear once a run has findings.</p>;
  }
  return (
    <ol className="m-motion-stagger grid gap-2 md:grid-cols-5" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {shown.map((a, i) => (
        <li key={a.id} className="grid content-start gap-2 py-3 pl-3" style={{ borderTop: "1px solid var(--m-line-strong)", borderLeft: "1px solid var(--m-line-strong)" }}>
          <span className="m-text-label tabular-nums" style={{ color: "var(--m-ink-3)" }} aria-label={`Rank ${i + 1}`}>#{i + 1}</span>
          <span className="m-text-body font-medium" style={{ color: "var(--m-ink)" }}>{a.title}</span>
          {a.impact && (
            <span className="flex flex-wrap gap-1">
              {a.impact.map((c) => (
                <span key={c} className="rounded-full px-2 m-text-meta" style={{ background: "var(--m-sheet-raised)", color: "var(--m-ink-2)" }}>{c}</span>
              ))}
            </span>
          )}
          <span className="inline-flex items-center gap-2">
            {a.href ? <Button render={<Link href={a.href}>{a.verb}</Link>} /> : <Button onClick={a.onClick}>{a.verb}</Button>}
            <Popover.Root>
              <Popover.Trigger className="m-text-meta underline" style={{ color: "var(--m-accent)" }}>Why?</Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner sideOffset={6}>
                  <Popover.Popup className="m-popup p-3 m-text-body" style={{ maxWidth: 280 }}>
                    {a.why}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          </span>
        </li>
      ))}
    </ol>
  );
}
