"use client";

import { AletheiaSheet, type AletheiaLabels } from "./AletheiaSheet";

/** Shell-level slot for the whole-landscape chat. Batch 8 replaces the empty thread with the real tools. */
export default function AletheiaPanel({ open, onClose, labels, suggestions }: { open: boolean; onClose: () => void; labels: AletheiaLabels; suggestions: string[] }) {
  return <AletheiaSheet open={open} onClose={onClose} labels={labels} thread={[]} suggestions={suggestions} onAsk={() => {}} />;
}
