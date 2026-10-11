"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Field } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
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
  const systemsQ = useQuery({ queryKey: ["systems"], queryFn: getSystems });
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
        onAdd={(g) => setGrants((cur) => [...cur, { id: String(cur.length) + g.role_key, role_key: g.role_key, system_id: g.system_id ?? null, module: g.module ?? null }])}
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
