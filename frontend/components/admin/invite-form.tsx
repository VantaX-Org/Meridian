"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, Select, toast } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
import { queryKeys } from "@/lib/query-keys";
import { listRoles, type GrantInput } from "@/lib/api/roles";
import { inviteUser } from "@/lib/api/users";
import { apiErrorMessage } from "@/lib/error";
import { email as emailRule, length, required, useFormErrors, type Schema } from "@/lib/forms";
import { ROLE_META, grantableRoles } from "@/lib/roles";
import { GrantsPicker, type GrantRowView } from "./grants-picker";

const SCHEMA: Schema<{ email: string; name: string }> = {
  email: [required("Enter an email address"), emailRule()],
  name: length(1, 120, "Use up to 120 characters"),
};

/**
 * Invite a user and choose their role. The role is an unscoped grant (every system); further grants for one system
 * or object are optional. The API writes the grants and derives users.role from the unscoped ones.
 */
export function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [grants, setGrants] = useState<(GrantRowView & GrantInput)[]>([]);
  const values = { email, name };
  const form = useFormErrors(SCHEMA, values);
  const qc = useQueryClient();
  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: listRoles });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  // Every persona and custom role, Platform admin included; legacy keys are refused by the API.
  const roleOptions = grantableRoles(rolesQ.data ?? []).map((r) => ({ value: r.key, label: r.name }));
  const roleDesc = (ROLE_META as Record<string, { desc: string } | undefined>)[role]?.desc;
  const extra = grants
    .filter((g) => !(role && g.role_key === role && !g.system_id && !g.module))
    .map((g) => ({ role_key: g.role_key, system_id: g.system_id, module: g.module }));
  const allGrants = [...(role ? [{ role_key: role, system_id: null, module: null }] : []), ...extra];
  const m = useMutation({
    mutationFn: () => inviteUser({ email, name: name || undefined, grants: allGrants }),
    onSuccess: () => {
      toast.success(`Invitation sent to ${email}`);
      // Users (both admin pages) and Roles and access list the invitee at once.
      void qc.invalidateQueries({ queryKey: queryKeys.users() });
      void qc.invalidateQueries({ queryKey: ["access-requests"] });
      onDone();
    },
    onError: (e) => toast.error(`Invitation not sent. ${apiErrorMessage(e)}`),
  });
  return (
    <form noValidate className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); form.touchAll(); if (form.valid && allGrants.length) m.mutate(); }}>
      <Field label="Email" error={form.error("email")}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => form.blur("email")} /></Field>
      <Field label="Name" error={form.error("name")}><input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => form.blur("name")} /></Field>
      <Field label="Role">
        <Select options={roleOptions} value={role} onValueChange={setRole} placeholder="Choose a role" />
      </Field>
      <p className="m-text-meta m-ink-3">{roleDesc ? `${roleDesc} Applies to every system.` : "The role applies to every system."}</p>
      <details className="flex flex-col gap-2">
        <summary className="m-text-body cursor-pointer">Add access for one system or object (optional)</summary>
        <GrantsPicker
          grants={grants} roles={rolesQ.data ?? []} systems={systemsQ.data ?? []}
          onAdd={(g) => setGrants((cur) => {
            const system_id = g.system_id ?? null, mod = g.module ?? null;
            if (cur.some((c) => c.role_key === g.role_key && c.system_id === system_id && c.module === mod)) return cur;
            return [...cur, { id: crypto.randomUUID(), role_key: g.role_key, system_id, module: mod }];
          })}
          onRemove={(g) => setGrants((cur) => cur.filter((c) => c.id !== g.id))}
        />
      </details>
      {allGrants.length === 0 ? <p className="m-text-meta m-ink-3">Choose a role, or add access for one system, to invite.</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!form.valid || allGrants.length === 0 || m.isPending}>Send invitation</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Close</Button>
      </div>
    </form>
  );
}
