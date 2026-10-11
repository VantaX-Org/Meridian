"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Field } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
import { queryKeys } from "@/lib/query-keys";
import { listRoles, type GrantInput } from "@/lib/api/roles";
import { inviteUser } from "@/lib/api/users";
import { apiErrorMessage } from "@/lib/error";
import { GrantsPicker, type GrantRowView } from "./grants-picker";

/** Invite a user with at least one role grant. */
export function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [grants, setGrants] = useState<(GrantRowView & GrantInput)[]>([]);
  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: listRoles });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const m = useMutation({
    mutationFn: () => inviteUser({
      email, name: name || undefined,
      grants: grants.map((g) => ({ role_key: g.role_key, system_id: g.system_id, module: g.module })),
    }),
    onSuccess: () => { toast.success(`Invitation sent to ${email}`); onDone(); },
    onError: (e) => toast.error(`Invitation not sent. ${apiErrorMessage(e)}`),
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (email && grants.length) m.mutate(); }}>
      <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <GrantsPicker
        grants={grants} roles={rolesQ.data ?? []} systems={systemsQ.data ?? []}
        onAdd={(g) => setGrants((cur) => {
          const system_id = g.system_id ?? null, mod = g.module ?? null;
          if (cur.some((c) => c.role_key === g.role_key && c.system_id === system_id && c.module === mod)) return cur;
          return [...cur, { id: crypto.randomUUID(), role_key: g.role_key, system_id, module: mod }];
        })}
        onRemove={(g) => setGrants((cur) => cur.filter((c) => c.id !== g.id))}
      />
      {grants.length === 0 ? <p className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Add at least one grant to invite.</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!email || grants.length === 0 || m.isPending}>Send invitation</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Close</Button>
      </div>
    </form>
  );
}
