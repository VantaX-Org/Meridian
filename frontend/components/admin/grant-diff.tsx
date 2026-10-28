"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, Notice, Skeleton } from "@/design";
import { previewGrant, type GrantDiff as GrantDiffData, type GrantInput } from "@/lib/api/roles";
import { apiErrorState } from "@/lib/error";
import { accessLabel } from "@/lib/rbac";
import { grantScopeLabel } from "@/lib/roles";
import { scopeLabel, type SystemRef } from "./grants-picker";

const SHOWN = 6;

/** "Adds: approve fixes; run extraction on every system", from what the grant would newly allow. */
export function grantDiffSentence(diff: GrantDiffData, where: string): string {
  if (!diff.added_pairs.length && !diff.added_actions.length) return "Adds nothing new. This person already has all of this access.";
  const labels = diff.added_pairs.length
    ? Array.from(new Set(diff.added_pairs.map(([r, a]) => accessLabel(r, a).toLowerCase())))
    : diff.added_actions.map((a) => a.replace(/[._]+/g, " "));
  const shown = labels.slice(0, SHOWN);
  const more = labels.length - shown.length;
  return `Adds: ${shown.join("; ")}${more > 0 ? `; and ${more.toLocaleString()} more` : ""} on ${where}`;
}

/**
 * What saving this grant would change, read from GET /users/{id}/effective?with_grant=, shown before the grant is
 * written. Save writes it; Close drops the draft.
 */
export function GrantDiff({ userId, grant, systems, saving, onSave, onClose }: {
  userId: string;
  grant: GrantInput;
  systems: SystemRef[];
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["grant-preview", userId, grant.role_key, grant.system_id ?? null, grant.module ?? null],
    queryFn: () => previewGrant(userId, grant),
  });
  const where = scopeLabel(grant.system_id, grant.module, systems) === "all"
    ? "every system"
    : grantScopeLabel(systems.find((s) => s.id === grant.system_id)?.name ?? null, grant.module);
  return (
    <div className="flex flex-col gap-3" aria-label="Grant preview" role="group">
      {q.isError ? <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton height={48} /> : (
        <Notice tone="info" title="What this grant changes">
          <p data-testid="grant-diff">{grantDiffSentence(q.data.diff, where)}</p>
          {grant.expires_at ? <p className="m-ink-3">It stops working on its expiry date.</p> : null}
        </Notice>
      )}
      <div className="flex gap-2">
        <Button disabled={saving || !q.data} pending={saving} onClick={onSave}>Save grant</Button>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
