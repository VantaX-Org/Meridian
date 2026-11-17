"use client";

import { useState } from "react";
import { Button, Card, Code, Confirm, DataTable, EmptyState, Field, Input, Select, SeverityPill, Sheet, type Column } from "@/ui/kit";
import { Frame, day, useAct, useCan, useSectionChat, useSync } from "../common";
import { useRolePermissions, useRoles, useRolesMatrix } from "@/lib/v2/admin-queries";
import { createRole, putRolePermissions, removeRole, updateRole, type Role } from "@/lib/api/v2/admin";
import { labelText, roleText } from "@/lib/v2/labels";
import { t, tx } from "@/lib/v2/i18n";

export function Roles() {
  const editable = useCan()("manage_users");
  const roles = useRoles();
  const matrix = useRolesMatrix();
  const { run, busy } = useAct();
  const [open, setOpen] = useState<Role | null>(null);
  const [del, setDel] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [desc, setDesc] = useState("");
  const rows = roles.data ?? [];

  useSectionChat("roles", t("Roles"), [t("{n} roles.", { n: rows.length })], [t("Which roles can approve?"), t("Who holds the most powerful role?")]);

  const cols: Column<Role>[] = [
    { key: "key", label: t("Role"), sort: (r) => r.key, render: (r) => <Code code={r.key} description={roleText(r.key)} /> },
    { key: "desc", label: t("Description"), render: (r) => (r.description ? tx(r.description) : "") },
    { key: "kind", label: t("Kind"), render: (r) => <SeverityPill sev={r.built_in ? "info" : "low"} label={r.built_in ? t("Built in") : t("Custom")} /> },
    { key: "users", label: t("People"), align: "end", sort: (r) => r.users ?? 0, render: (r) => (r.users ?? 0) },
    { key: "upd", label: t("Updated"), sort: (r) => r.updated_at ?? "", render: (r) => day(r.updated_at) },
    { key: "act", label: "", render: (r) => <Button variant="ghost" type="button" onClick={() => setOpen(r)}>{t("Open")}</Button> },
  ];

  const create = async () => {
    const r = await run(() => createRole({ name: name.trim(), cloned_from: from, description: desc.trim() || undefined }), t("Role created."), ["roles"]);
    if (r) { setName(""); setFrom(""); setDesc(""); }
  };

  const m = matrix.data;
  const mcols: Column<Role>[] = m ? [
    { key: "name", label: t("Role"), render: (r) => <Code code={r.key} description={roleText(r.key)} /> },
    ...m.resources.map((res) => ({
      key: res, label: labelText(res), align: "end" as const,
      render: (r: Role) => String(Object.values(m.roles.find((x) => x.key === r.key)?.matrix[res] ?? {}).filter(Boolean).length),
    })),
  ] : [];

  return (
    <Frame slug="roles" title={t("Roles")} lead={t("What each role may do. Built-in roles are read only; clone one to change it.")} loading={roles.isLoading} error={roles.isError}>
      {rows.length === 0 ? <EmptyState heading={t("No roles")} body={t("Clone a built-in role to start.")} /> : (
        <Card title={t("All roles")} sub={t("{n} roles", { n: rows.length })}>
          <DataTable columns={cols} rows={rows} rowKey={(r) => r.key} label={t("Roles")} />
        </Card>
      )}
      {m && (
        <Card title={t("Permission matrix")} sub={t("Allowed actions per area, counted for each role.")}>
          <DataTable columns={mcols} rows={rows} rowKey={(r) => r.key} label={t("Permission matrix")} height={280} />
        </Card>
      )}
      {editable && (
        <Card title={t("New role")} sub={t("A role starts as a copy of an existing one.")}>
          <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <Field label={t("Name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t("Copy from")}>
              <Select value={from} onChange={(e) => setFrom(e.target.value)} options={[{ value: "", label: t("Choose a role") }, ...rows.map((r) => ({ value: r.key, label: tx(r.name) }))]} />
            </Field>
            <Field label={t("Description")} hint={t("Optional.")}><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
            <div><Button variant="primary" type="submit" disabled={busy || !name.trim() || !from}>{t("Create role")}</Button></div>
          </form>
        </Card>
      )}
      <RoleSheet role={open} editable={editable} onClose={() => setOpen(null)} onDelete={setDel} />
      <Confirm
        open={!!del}
        danger
        title={t("Remove this role?")}
        confirmLabel={t("Remove")}
        cancelLabel={t("Cancel")}
        onCancel={() => setDel(null)}
        onConfirm={() => { const r = del; setDel(null); setOpen(null); if (r) void run(() => removeRole(r.key), t("Role removed."), ["roles"]); }}
      >
        <p>{del?.users ? t("{n} people still hold this role. Move them first.", { n: del.users }) : del ? tx(del.name) : ""}</p>
      </Confirm>
    </Frame>
  );
}

function RoleSheet({ role, editable, onClose, onDelete }: { role: Role | null; editable: boolean; onClose: () => void; onDelete: (r: Role) => void }) {
  const key = role?.key ?? "";
  const perm = useRolePermissions(key, !!role);
  const { run, busy } = useAct();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [on, setOn] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState(role);
  if (role !== seen) { setSeen(role); setName(role?.name ?? ""); setDesc(role?.description ?? ""); }
  useSync(perm.data, (d) => {
    const s = new Set<string>();
    for (const [res, acts] of Object.entries(d.matrix ?? {})) for (const [a, ok] of Object.entries(acts)) if (ok) s.add(`${res}\u0000${a}`);
    setOn(s);
  });
  if (!role) return <Sheet open={false} onClose={onClose} label="" closeLabel="">{null}</Sheet>;
  const custom = editable && !role.built_in;
  const matrix = perm.data?.matrix ?? {};
  const flip = (k: string) => setOn((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const save = () => run(() => putRolePermissions(key, [...on].map((k) => { const [resource, action] = k.split("\u0000"); return { resource, action }; })), t("Permissions saved."), ["roles"]);

  return (
    <Sheet open onClose={onClose} label={tx(role.name)} closeLabel={t("Close")}>
      <div className="mx-col">
        <p><Code code={role.key} description={roleText(role.key)} /></p>
        {custom && (
          <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => updateRole(key, { name: name.trim(), description: desc.trim() }), t("Role saved."), ["roles"]); }}>
            <Field label={t("Name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t("Description")}><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
            <div><Button variant="secondary" type="submit" disabled={busy || !name.trim()}>{t("Save details")}</Button></div>
          </form>
        )}
        <Card title={t("Permissions")} sub={custom ? t("Tick what this role may do.") : t("Built-in roles cannot be changed.")}>
          {Object.keys(matrix).length === 0 ? <EmptyState heading={t("No permissions")} body={t("This role grants nothing.")} /> : (
            <ul className="mx-col">
              {Object.entries(matrix).map(([res, acts]) => (
                <li key={res}>
                  <strong>{labelText(res)}</strong>
                  <span className="mx-links">
                    {Object.keys(acts).map((a) => (
                      <label key={a} className="mx-links">
                        <input type="checkbox" disabled={!custom} checked={on.has(`${res}\u0000${a}`)} onChange={() => flip(`${res}\u0000${a}`)} />
                        <span>{labelText(a)}</span>
                      </label>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {custom && (
          <div className="mx-links">
            <Button variant="primary" type="button" disabled={busy} onClick={() => void save()}>{t("Save permissions")}</Button>
            <Button variant="ghost" type="button" disabled={busy || !!role.users} onClick={() => onDelete(role)}>{t("Remove role")}</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
