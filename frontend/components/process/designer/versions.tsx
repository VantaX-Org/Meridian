"use client";

import { useQuery } from "@tanstack/react-query";
import { Menu, MenuItem } from "@/components/aurora";
import { Banner, Button } from "@/components/ui-core";
import { listModelVersions } from "@/lib/api/process-designer";
import { formatDate } from "@/lib/format";

/** Versions menu: picking one opens it read-only. */
export function VersionsMenu({ modelId, shown, onPick }: { modelId: string; shown: number | null; onPick: (no: number | null) => void }) {
  const q = useQuery({ queryKey: ["pd.versions", modelId], queryFn: () => listModelVersions(modelId) });
  const rows = q.data ?? [];
  return (
    <Menu label="Versions" trigger="Versions" width={300}>
      {rows.length === 0 ? <p className="ui-note">No saved versions yet.</p> : null}
      {rows.map((r, i) => (
        <MenuItem key={r.version_no} aria-current={(shown ?? rows[0].version_no) === r.version_no} onClick={() => onPick(i === 0 ? null : r.version_no)}>
          Version {r.version_no}{r.created_at ? `, ${formatDate(r.created_at)}` : ""}{r.note ? `, ${r.note}` : ""}
        </MenuItem>
      ))}
    </Menu>
  );
}

export function OldVersionBanner({ viewing, latest, busy, onRestore, onLatest }: {
  viewing: number; latest: number; busy: boolean; onRestore: () => void; onLatest: () => void;
}) {
  return (
    <Banner tone="info" title={`Viewing version ${viewing} of ${latest}`}
      action={<><Button size="sm" variant="primary" disabled={busy} onClick={onRestore}>Restore as new version</Button>{" "}<Button size="sm" variant="ghost" onClick={onLatest}>Back to latest</Button></>}>
      This version is read-only.
    </Banner>
  );
}
