"use client";

import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { GLOSSARY, type GlossaryKey } from "@/lib/help/glossary";
import { Card } from "./Card";
import { Tooltip } from "./Tooltip";
import { IconInfo } from "../icons";

/**
 * A 14px info button (a 24px hit area) for a glossary term. Hover or focus shows the short
 * definition in a tooltip; a click opens a popover with the long text and a
 * "Learn more" link when the entry has one.
 */
export function HelpHint({ term, onHero = false }: { term: GlossaryKey; /** Hero tiles sit on the dark hero zone in both themes. */ onHero?: boolean }) {
  const entry = GLOSSARY[term];
  if (!entry) return null;
  return (
    <Popover.Root>
      <Tooltip
        label={entry.short}
        maxWidth={280}
        render={
          <Popover.Trigger
            aria-label={`About ${entry.term}`}
            className="m-motion-colors inline-flex shrink-0 items-center justify-center rounded-full"
            // A 24px hit area around the 14px glyph; the -5px margin keeps its footprint at 14px, so nothing shifts.
            style={{ width: 24, height: 24, margin: -5, color: onHero ? "var(--m-hero-ink-2)" : "var(--m-ink-3)" }}
          />
        }
      >
        <IconInfo size={14} />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} className="z-50">
          <Popover.Popup className="m-motion-scale-in" style={{ width: 320, maxWidth: "calc(100vw - 32px)", boxShadow: "var(--m-elev-2)", borderRadius: "var(--m-radius-sheet)" }}>
            <Card title={entry.term} padding="sm">
              <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>{entry.long}</p>
              {entry.href && (
                <p className="mt-2 m-text-body">
                  <Link href={entry.href} className="m-ink-accent underline underline-offset-2">Learn more</Link>
                </p>
              )}
            </Card>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
