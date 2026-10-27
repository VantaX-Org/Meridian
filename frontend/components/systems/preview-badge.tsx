"use client";

import { Pill, Tooltip } from "@/design";
import type { PreviewSource } from "@/types/api";

/** The tooltip of every Preview badge: a registry source whose name is not backed by a dictionary in this repo. */
export const PREVIEW_SOURCE_HINT = "Source name not yet verified against SAP; extraction may fail";

/**
 * "Preview" next to an object or table whose extraction source is unverified (sap/extraction_registry.py,
 * status "preview"). Nothing renders when every source is verified. The trigger is a focusable span, not a
 * button, so it sits inside clickable table rows without nesting interactive elements.
 */
export function PreviewBadge({ sources }: { sources?: readonly PreviewSource[] }) {
  if (!sources?.length) return null;
  const names = sources.map((s) => s.source).join(", ");
  return (
    <Tooltip
      label={PREVIEW_SOURCE_HINT}
      render={<span tabIndex={0} aria-label={`Preview: ${names}. ${PREVIEW_SOURCE_HINT}`} onClick={(e) => e.stopPropagation()} />}
    >
      <Pill tone="info">Preview</Pill>
    </Tooltip>
  );
}
