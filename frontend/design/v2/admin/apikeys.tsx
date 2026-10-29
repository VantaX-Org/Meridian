"use client";

import type { ApiKey, ApiKeyStatus } from "@/lib/api/api-keys";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { useApiKeys } from "@/lib/v2/admin-queries";
import { type GridColumn } from "../Grid";
import { EmptyFrame, ErrorFrame, Mono } from "../parts";
import { AdminPage, Block, NeedsPermission, StatusWord, since, useCan } from "./kit";
import { ToolGrid } from "../GridTools";

const TONE: Record<ApiKeyStatus, "go" | "at-risk" | "no-go" | "neutral"> = { active: "go", expired: "at-risk", revoked: "no-go", suspended: "neutral" };
const WORD: Record<ApiKeyStatus, string> = { active: "Active", expired: "Expired", revoked: "Revoked", suspended: "Suspended" };

export const keyRoles = (k: ApiKey): string =>
  k.grants.length === 0
    ? "No roles"
    : k.grants.map((g) => `${g.role_name}${g.system_name ? `, ${g.system_name}` : ""}${g.module ? `, ${g.module}` : ""}`).join("; ");

const COLUMNS: GridColumn<ApiKey>[] = [
  { id: "name", header: "Name", width: 240, pin: true, locked: true, cell: (k) => k.name },
  { id: "prefix", header: "Key", width: 130, cell: (k) => <Mono>{`${k.key_prefix}…`}</Mono> },
  { id: "roles", header: "Roles", width: 300, cell: (k) => keyRoles(k) },
  { id: "status", header: "Status", width: 120, cell: (k) => <StatusWord tone={TONE[k.status]}>{WORD[k.status]}</StatusWord> },
  { id: "used", header: "Last used", width: 130, cell: (k) => since(k.last_used_at, "Never used") },
  { id: "expires", header: "Expires", width: 130, cell: (k) => (k.expires_at ? formatDate(k.expires_at) : "Never") },
  { id: "by", header: "Created by", width: 160, defaultHidden: true, cell: (k) => k.created_by_name ?? "—" },
];

/** Admin › API keys: keys for scripts, each with its own service account and roles; the secret is shown once, on creation. */
export function ApiKeysSection() {
  const can = useCan();
  const { openItem, open } = useOpenItem();
  const allowed = can("manage_users");
  const q = useApiKeys(allowed);
  if (!allowed) return <AdminPage title="API keys"><NeedsPermission what="Managing API keys" permission="manage_users" /></AdminPage>;
  const rows = q.data ?? [];
  const active = rows.filter((k) => k.status === "active").length;
  return (
    <AdminPage
      title="API keys"
      lead={`${active} active ${active === 1 ? "key" : "keys"}. A key acts as its own service account with only the roles you give it, and shows in the audit log under its name. The key itself is shown once, when you create it.`}
      actions={
        <button type="button" className="m2-btn m2-next" onClick={() => openItem({ kind: "apikey", id: "new" })}>
          Create a key
        </button>
      }
    >
      <Block>
        <ToolGrid<ApiKey>
          toolsTitle="API keys"
          id="admin-apikeys"
          ariaLabel="API keys"
          columns={COLUMNS}
          rows={rows}
          rowId={(k) => k.id}
          loading={q.isPending}
          error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{`The keys could not be read. ${apiErrorMessage(q.error)}`}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>No API keys yet. Create one for a script or a BI tool, with only the roles it needs.</EmptyFrame>}
          onOpen={(k) => openItem({ kind: "apikey", id: k.id })}
          openRowId={open?.kind === "apikey" ? open.id : null}
        />
      </Block>
    </AdminPage>
  );
}
