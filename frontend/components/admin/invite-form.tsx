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
import { email as emailRule, length, required, useFormErrors, type Schema } from "@/lib/forms";
import { GrantsPicker, type GrantRowView } from "./grants-picker";

const SCHEMA: Schema<{ email: string; name: string }> = {
  email: [required("Enter an email address"), emailRule()],
  name: length(1, 120, "Use up to 120 characters"),
};

/** Invite a user with at least one role grant. */
export function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [grants, setGrants] = useState<(GrantRowView & GrantInput)[]>([]);
  const values = { email, name };
  const form = useFormErrors(SCHEMA, values);
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
    <form noValidate className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); form.touchAll(); if (form.valid && grants.length) m.mutate(); }}>
      <Field label="Email" error={form.error("email")}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => form.blur("email")} /></Field>
      <Field label="Name" error={form.error("name")}><input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => form.blur("name")} /></Field>
      <GrantsPicker
        grants={grants} roles={rolesQ.data ?? []} systems={systemsQ.data ?? []}
        onAdd={(g) => setGrants((cur) => {
          const system_id = g.system_id ?? null, mod = g.module ?? null;
          if (cur.some((c) => c.role_key === g.role_key && c.system_id === system_id && c.module === mod)) return cur;
          return [...cur, { id: crypto.randomUUID(), role_key: g.role_key, system_id, module: mod }];
        })}
        onRemove={(g) => setGrants((cur) => cur.filter((c) => c.id !== g.id))}
      />
      {grants.length === 0 ? <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>Add at least one grant to invite.</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!form.valid || grants.length === 0 || m.isPending}>Send invitation</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Close</Button>
      </div>
    </form>
  );
}
