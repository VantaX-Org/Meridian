"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Menu, Notice } from "@/design";
import { listModelVersions } from "@/lib/api/process-designer";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

/** Versions menu: picking one opens it read-only. */
export function VersionsMenu({ modelId, shown, onPick }: { modelId: string; shown: number | null; onPick: (no: number | null) => void }) {
  const q = useQuery({ queryKey: queryKeys.processModelVersions(modelId), queryFn: () => listModelVersions(modelId) });
  const rows = q.data ?? [];
  const items = rows.length
    ? rows.map((r, i) => ({
        label: `Version ${r.version_no}${r.created_at ? `, ${formatDate(r.created_at)}` : ""}${r.note ? `, ${r.note}` : ""}${(shown ?? rows[0].version_no) === r.version_no ? " (current)" : ""}`,
        onSelect: () => onPick(i === 0 ? null : r.version_no),
      }))
    : [{ label: "No saved versions yet.", onSelect: () => {} }];
  return <Menu trigger={<Button variant="secondary">Versions</Button>} items={items} />;
}

export function OldVersionBanner({ viewing, latest, busy, onRestore, onLatest }: {
  viewing: number; latest: number; busy: boolean; onRestore?: () => void; onLatest: () => void;
}) {
  return (
    <Notice
      tone="info"
      title={`Viewing version ${viewing} of ${latest}`}
      action={<>
        {onRestore ? <Button variant="primary" disabled={busy} onClick={onRestore}>Restore as new version</Button> : null}
        <Button variant="ghost" onClick={onLatest}>Back to latest</Button>
      </>}
    >
      This version is read-only.
    </Notice>
  );
}
