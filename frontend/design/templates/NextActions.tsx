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
    return <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Nothing to do yet. Actions appear once a run has findings.</p>;
  }
  return (
    <ol className="m-motion-stagger grid gap-2 md:grid-cols-5" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {shown.map((a, i) => (
        <li key={a.id} className="grid content-start gap-2 p-3" style={{ background: "var(--m-sheet)", boxShadow: "var(--m-elev-1)", borderRadius: "var(--m-radius-sheet)" }}>
          <span className="text-[11px] tabular-nums" style={{ color: "var(--m-ink-3)" }} aria-label={`Rank ${i + 1}`}>#{i + 1}</span>
          <span className="text-[13px] leading-[18px] font-medium" style={{ color: "var(--m-ink)" }}>{a.title}</span>
          {a.impact && (
            <span className="flex flex-wrap gap-1">
              {a.impact.map((c) => (
                <span key={c} className="rounded-full px-2 text-[12px]" style={{ background: "var(--m-sheet-raised)", color: "var(--m-ink-2)" }}>{c}</span>
              ))}
            </span>
          )}
          <span className="inline-flex items-center gap-2">
            {a.href ? <Button render={<Link href={a.href}>{a.verb}</Link>} /> : <Button onClick={a.onClick}>{a.verb}</Button>}
            <Popover.Root>
              <Popover.Trigger className="text-[12px] underline" style={{ color: "var(--m-accent)" }}>Why?</Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner sideOffset={6}>
                  <Popover.Popup className="rounded p-3 text-[13px]" style={{ background: "var(--m-sheet)", color: "var(--m-ink)", boxShadow: "var(--m-elev-2)", maxWidth: 280 }}>
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
