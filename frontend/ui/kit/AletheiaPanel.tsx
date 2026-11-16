"use client";

import { AletheiaSheet, type AletheiaLabels } from "./AletheiaSheet";
import { useAletheia } from "./aletheia";

/** The one chat instance, mounted by the shell. It reads its open state, thread and scope from AletheiaProvider. */
export default function AletheiaPanel({ labels }: { labels: AletheiaLabels }) {
  const { open, setOpen, scope, thread, ask } = useAletheia();
  return (
    <AletheiaSheet
      open={open}
      onClose={() => setOpen(false)}
      labels={scope ? { ...labels, scope: scope.label } : labels}
      thread={thread}
      suggestions={scope?.suggestions ?? []}
      onAsk={ask}
    />
  );
}
