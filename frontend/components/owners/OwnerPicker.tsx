"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState, Field, Select, Skeleton } from "@/design";
import { getOwners, putOwner, type OwnerKind } from "@/lib/api/owners";
import { getAssignableUsers } from "@/lib/api/users";
import { apiErrorDetail, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

// Base UI Select treats "" as no value, so "not set" is a sentinel.
const NONE = "none";

export function OwnerPicker({ kind, refId }: { kind: OwnerKind; refId: string }) {
  const qc = useQueryClient();
  const owners = useQuery({
    queryKey: queryKeys.owners(kind),
    queryFn: () => getOwners(kind),
    retry: false,
    meta: { ignoreError: true },
  });
  // Listing users needs the assign permission; without it the picker is read-only.
  const users = useQuery({
    queryKey: queryKeys.usersAssignable(),
    queryFn: getAssignableUsers,
    retry: false,
    meta: { ignoreError: true },
  });
  const row = owners.data?.find((o) => o.ref === refId);
  const save = useMutation({
    mutationFn: (patch: { owner_user_id?: string | null; steward_user_id?: string | null }) =>
      putOwner({
        kind,
        ref: refId,
        owner_user_id: row?.owner_user_id ?? null,
        steward_user_id: row?.steward_user_id ?? null,
        ...patch,
      }),
    onSuccess: () => {
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: queryKeys.owners(kind) });
    },
    onError: (e) => toast.error(apiErrorDetail(e) ?? "Not saved"),
  });

  if (owners.isLoading || users.isLoading) return <Skeleton height={32} />;
  if (isListFailure(owners)) return <ErrorState message="Owners could not be read." onRetry={() => owners.refetch()} />;
  if (users.isError || !users.data) {
    return (
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
        {row && (row.owner_name || row.steward_name)
          ? `Owner: ${row.owner_name ?? "not set"}. Steward: ${row.steward_name ?? "not set"}.`
          : "No owner set."}
      </p>
    );
  }
  const options = [{ value: NONE, label: "Not set" }, ...users.data.map((u) => ({ value: u.id, label: u.name }))];
  const picked = (v: string) => (v === NONE ? null : v);
  return (
    <div className="flex flex-wrap gap-4">
      <Field label="Owner">
        <Select
          value={row?.owner_user_id ?? NONE}
          onValueChange={(v) => save.mutate({ owner_user_id: picked(v) })}
          options={options}
        />
      </Field>
      <Field label="Steward">
        <Select
          value={row?.steward_user_id ?? NONE}
          onValueChange={(v) => save.mutate({ steward_user_id: picked(v) })}
          options={options}
        />
      </Field>
    </div>
  );
}
