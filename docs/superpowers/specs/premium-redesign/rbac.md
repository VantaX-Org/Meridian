# Meridian RBAC — extension of `api/services/rbac.py`

Design rule: **extend, never replace.** `api/services/rbac.py` today is a flat `PERMISSIONS: dict[str, set[str]]` (roles admin, manager, steward, analyst, approver, auditor, ai_reviewer, viewer; ~22 action strings) consumed by `require_permission(action)` at 200+ call sites, plus `can_approve_for_object` reading `users.permissions` JSONB. Every one of those call sites, every action string and every role name keeps working unchanged. This document adds persona roles, resource × action semantics, scoping by SAP system and module, custom roles, `/me/permissions`, the admin UI, and the migration from the current map. RLS stays tenant-level; RBAC sits on top inside the tenant.

---

## 1. Roles

### 1.1 Persona roles (new keys) and legacy mapping

| Persona role key | Display name | Default home | Built from legacy | Legacy keys that map here |
|---|---|---|---|---|
| `programme_lead` | Programme lead / CIO | `/home/lead` | `manager` + `approve` on migration sign-off, `export` | `manager` |
| `data_steward` | Data steward | `/home/steward` | `steward` | `steward` |
| `data_owner` | Data owner / approver | `/home/steward` | `approver` | `approver` |
| `analyst` | Analyst | `/home/lead` | `analyst` | `analyst`, `ai_reviewer` (gets `review_ai_rules`, `ai_feedback`, `trigger_ai` as extra actions) |
| `sap_basis` | SAP Basis / integration admin | `/home/basis` | `analyst` + `manage_systems`, `trigger_sync`, `manage_field_mappings`, `upload` | none (new) |
| `platform_admin` | Platform admin | `/home/lead` | `admin` | `admin` |
| `auditor` | Auditor | `/home/lead` (read-only) | `auditor` | `auditor` |
| `viewer` | Viewer | `/home/lead` (read-only) | `viewer` | `viewer` |
| `process_analyst` | Process analyst | `/home/process` | `viewer` + `run_process_discovery`, `export_process` | none (new; process-discovery spec §6.1) |

Legacy keys stay in `PERMISSIONS` and `VALID_ROLES`. `users.role` keeps accepting them. Persona keys are added to the same dict as the union described above, so `has_permission("programme_lead", "export")` is true with zero new code paths. `ai_reviewer` remains valid as a legacy alias; the Roles UI shows it under "Legacy" with "Upgrade to Analyst" until no user holds it.

### 1.2 Custom roles

A custom role is a tenant-scoped row in `roles` cloned from a built-in; it carries its own `role_permissions`. Its key is `custom:<slug>`. `permissions_for(role)` resolves: built-in dict first, then `roles` table (cached per process, invalidated on write). `users.role` stores the key as before.

---

## 2. Permission model

### 2.1 Resources × actions

Actions: `view`, `create`, `edit`, `approve`, `run`, `export`, `admin`.

Resources: `systems`, `credentials`, `extraction`, `analysis`, `rules`, `findings`, `fixes`, `mdm`, `glossary`, `stewardship`, `contracts`, `reports`, `llm`, `users`, `licence`, `audit`, `process`.

Every existing action string maps to one or more (resource, action) pairs. The map lives in `rbac.py` as `LEGACY_ACTION_MAP: dict[str, set[tuple[str, str]]]`:

| Legacy action | (resource, action) |
|---|---|
| `view` | (`*`, `view`) except `audit`, `llm`, `users`, `licence`, `credentials` |
| `mdm.read` | (`mdm`, `view`) |
| `mdm.write` | (`mdm`, `edit`) |
| `view_ai_confidence` | (`findings`, `view`) + flag `ai_confidence` |
| `upload` | (`extraction`, `create`) |
| `trigger_sync` | (`extraction`, `run`) |
| `analyse` | (`analysis`, `run`) |
| `trigger_ai` | (`analysis`, `run`) + (`llm`, `view`) |
| `approve` | (`fixes`, `approve`), (`mdm`, `approve`), (`stewardship`, `approve`), (`analysis`, `approve`) [migration sign-off] |
| `apply` | (`fixes`, `run`) |
| `assign` | (`stewardship`, `edit`) |
| `export` | (`reports`, `export`) and (`*`, `export`) except `process` |
| `manage_rules` | (`rules`, `create`/`edit`), (`contracts`, `create`/`edit`), (`glossary`, `edit`) |
| `review_ai_rules` | (`rules`, `approve`) |
| `ai_feedback` | (`findings`, `edit`) |
| `manage_field_mappings` | (`extraction`, `edit`) |
| `manage_systems` | (`systems`, `create`/`edit`/`admin`), (`credentials`, `edit`) |
| `manage_system` (platform update, admin doctor) | (`licence`, `admin`): held only by `admin` / `platform_admin`, so no custom clone of another role reaches it |
| `manage_settings` | (`analysis`, `admin`), (`reports`, `admin`), (`rules`, `admin`) |
| `manage_llm` | (`llm`, `admin`) |
| `manage_users` | (`users`, `admin`) |
| `view_audit` | (`audit`, `view`), (`audit`, `export`) |
| `run_process_discovery` | (`process`, `run`): held by `admin` / `platform_admin` and `process_analyst` |
| `export_process` | (`process`, `export`): held by `admin` / `platform_admin`, `manager` / `programme_lead` and `process_analyst` |

### 2.2 Full matrix (built-in roles)

Legend: V view · C create · E edit · A approve · R run · X export · ★ admin. Blank = no access. `platform_admin` has everything.

| Resource | programme_lead | data_steward | data_owner | analyst | sap_basis | auditor | viewer |
|---|---|---|---|---|---|---|---|
| systems | V X | V | V | V | V C E ★ X | V | V |
| credentials | | | | | E | | |
| extraction | V | V | V | V C | V C E R | V | V |
| analysis | V R A X | V R | V A | V R X | V R | V | V |
| rules | V X | V | V | V C E A X | V C E | V | V |
| findings | V X | V E X | V E X | V E X | V | V | V |
| fixes | V A X | V C E R X | V A X | V C X | V | V | V |
| mdm | V A X | V E X | V A X | V X | V | V | V |
| glossary | V | V E | V E A | V E | V | V | V |
| stewardship | V | V E A | V E A | V E | V | V | V |
| contracts | V A | V | V A | V C E | V | V | V |
| reports | V X ★ | V X | V X | V X | V X | V X | V |
| llm | | | | V | | | |
| users | V | | | | | V | |
| licence | V | | | | V | V | |
| audit | V | | | | | V X | |
| process | V X | V | V | V | V | V | V |

Derivation from the current map (so behaviour today is not reduced): `manager` already has approve/apply/export/assign/manage_rules/manage_settings; `programme_lead` keeps all of those (`apply` kept for compatibility though the UI hides "Apply" for leads). `steward` has upload/analyse/approve/apply/export/assign/manage_rules/mdm.write — mapped above. `approver` has approve/export/assign. `analyst` has upload/analyse/export/ai_feedback/manage_rules/trigger_ai. `auditor` has view_audit/export. `viewer` is `_READ`. `process_analyst` and `platform_admin` hold V R X on `process`; nobody reaches (`process`, `export`) through the legacy `export` action, so case-level data leaves only with `export_process`.

### 2.3 Scope dimensions

A grant is `(role, system_id | null, module | null)`. `null` = all. A user may hold several grants (`user_role_scopes`). Effective permission for a request = union over grants whose scope matches the request's `system_id` / `module` (both null-safe). Resources without a natural scope (`users`, `licence`, `llm`, `audit`) ignore scope: a scoped grant of a role that has `users ★` still grants it tenant-wide, and the matrix editor shows a lock icon on those rows when a scope is chosen.

Module = the SAP module key (`material_master`, `employee_central`, …) resolved from the route's `module` / `object_type` path or query param; system from `system_id` path/query or `analysis_versions.system_id` when only a `version_id` is present (one lookup, cached per request).

---

## 3. Backend contract

### 3.1 Tables (Alembic migration 044, additive only)

```sql
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text NOT NULL,                 -- 'programme_lead' | 'custom:eu-stewards'
  name text NOT NULL,
  description text,
  built_in boolean NOT NULL DEFAULT false,
  cloned_from text,                  -- key of the built-in it was copied from
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);
CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  resource text NOT NULL,
  action text NOT NULL,
  PRIMARY KEY (role_id, resource, action)
);
CREATE TABLE user_role_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_key text NOT NULL,            -- built-in key or 'custom:…'
  system_id uuid REFERENCES sap_systems(id) ON DELETE CASCADE,  -- null = all
  module text,                       -- null = all
  granted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_key, system_id, module)
);
CREATE TABLE access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  resource text NOT NULL, action text NOT NULL,
  system_id uuid, module text, reason text,
  status text NOT NULL DEFAULT 'open',   -- open | granted | declined
  decided_by uuid, decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

RLS policies on all four by `tenant_id` (same template as every other table). Built-in roles are **not** inserted as rows; they live in code. `roles` holds only custom roles plus optional per-tenant overrides (`built_in=true, key=<builtin>`) when a tenant edits a built-in's matrix — the editor offers "Clone" first and "Override built-in" second.

Role changes write `audit_log` rows with `action in ('role.create','role.update','role.delete','grant.create','grant.delete','access_request.decide')` and `details` = before/after JSON.

### 3.2 `rbac.py` additions (backward compatible)

```python
# unchanged: PERMISSIONS, _READ, VALID_ROLES, permissions_for, has_permission,
#            can_approve_for_object, dev_role_override, _get_user_role

PERSONA_ROLES: dict[str, set[str]] = {
    "programme_lead": PERMISSIONS["manager"],
    "data_steward":   PERMISSIONS["steward"],
    "data_owner":     PERMISSIONS["approver"],
    "sap_basis":      PERMISSIONS["analyst"] | {"manage_systems",
                      "trigger_sync", "manage_field_mappings", "upload"},
    "platform_admin": PERMISSIONS["admin"],
}
PERMISSIONS.update(PERSONA_ROLES)          # legacy keys remain
PERMISSIONS["analyst"] |= {"review_ai_rules", "ai_feedback", "trigger_ai"}  # absorbs ai_reviewer
VALID_ROLES = set(PERMISSIONS.keys())

RESOURCES = ("systems","credentials","extraction","analysis","rules","findings","fixes",
             "mdm","glossary","stewardship","contracts","reports","llm","users","licence","audit")
ACTIONS = ("view","create","edit","approve","run","export","admin")
LEGACY_ACTION_MAP: dict[str, set[tuple[str, str]]] = {...}   # §2.1

@dataclass(frozen=True)
class Scope:
    system_id: UUID | None = None
    module: str | None = None

def grants_for(user_id: UUID, tenant_id: UUID) -> list[tuple[str, Scope]]:
    """user_role_scopes rows; falls back to [(users.role, Scope())] when none exist."""

def actions_for(role_key: str, tenant_id: UUID) -> set[str]:
    """permissions_for() for built-ins; roles/role_permissions → legacy actions for custom."""

def has_permission_scoped(grants, action: str, scope: Scope) -> bool:
    return any(has_permission(role, action) and _scope_matches(s, scope) for role, s in grants)

def require_permission(action: str, *, resource: str | None = None,
                       scope: Callable[[Request], Scope] | None = None):
    """Existing single-arg calls behave exactly as today (tenant-wide check on users.role
    union of grants). When `scope` is given, the dependency resolves Scope from the request
    (path/query system_id, module, object_type, or version_id → system) and checks the
    matching grants only. `resource` is informational for /me/permissions and audit."""
```

Resolution order inside the dependency: `dev_role_override` → JWT → `grants_for` (empty → `[(users.role, Scope())]`) → `has_permission_scoped`. On failure of a scoped check: 403 whose body is nested by FastAPI, `{"detail": {"detail": "forbidden", "resource": …, "action": …, "request_access": true}}`, so the UI reads `body.detail.request_access` to offer the request-access flow. Tenant-wide (unscoped) checks keep the legacy string detail.

Rollout of `scope=`: routes under `systems`, `connectivity`, `objects`, `findings`, `versions`, `migration`, `cleaning`, `remediation`, `master_records`, `stewardship` get `scope=scope_from_path` in wave 14; everything else stays tenant-wide. Nothing becomes more permissive at any step.

### 3.3 Endpoints

| Method path | Permission | Returns |
|---|---|---|
| `GET /api/v1/me/permissions` | any signed-in | `{ role, roles: [{key, name, system_id, module}], actions: string[], resources: {resource: {action: bool}}, scopes: [{system_id, module}], home: "/home/lead" }` — `resources` is the tenant-wide union; a `?system_id=&module=` query narrows it |
| `GET /api/v1/roles` | `view` on `users` | built-ins + custom with counts |
| `POST /api/v1/roles` (clone) · `PUT /{key}` · `DELETE /{key}` | `manage_users` | role |
| `GET /api/v1/roles/{key}/permissions` · `PUT` | `manage_users` | matrix |
| `GET /api/v1/users/{id}/grants` · `POST` · `DELETE /{grant_id}` | `manage_users` | grants |
| `GET /api/v1/users/{id}/effective?system_id=&module=` | `manage_users` or self | same shape as `/me/permissions` |
| `POST /api/v1/users/invite` (existing) | `manage_users` | body gains `grants: [{role_key, system_id?, module?}]`; `role` still accepted |
| `POST /api/v1/access-requests` · `GET` · `POST /{id}/decide` | signed-in / `manage_users` | request |

`/api/v1/auth/me` returns the legacy action list resolved over the user's unscoped grants (so custom roles count) and adds `home`.

Escalation guards (all 403 unless noted):

- **Ceiling.** Granting, inviting, re-roling a user, removing a grant, cloning a role and editing a custom role's matrix all require the role's effective permissions to be a subset of the caller's own at that scope.
- **Admin-equivalent.** `admin` and `platform_admin` are equal. Only a holder of either may grant, invite into, re-role to, clone or define an admin-equivalent role: either key, or any custom role holding (`licence`, `admin`).
- **Deactivate / reactivate / delete.** `PUT /users/{id}` with `is_active` and `DELETE /users/{id}` require the target's `users.role` and every grant (each at its own scope) to sit under the caller. Never on yourself.
- **Custom role edits.** Renaming, deleting or rewriting the matrix of a custom role also requires its *current* permissions to sit under the caller, so nobody strips a role held above them.
- **Self.** Nobody may grant, remove, re-role, deactivate or delete their own access, or decide their own access request. User ids are compared as UUIDs, never as strings.
- **Mirror grant.** The unscoped grant equal to `users.role` cannot be deleted: 409, pointing at `PUT /users/{id}`. No audit row is written.
- **Decide.** A granted `role_key` must confer the requested (resource, action), else 422, and then passes the ceiling.
- **Request.** `POST /access-requests` refuses with 422 a (resource, action) that no legacy action yields (e.g. `users`/`view`), since no role could ever confer it. The queue and the effective view count custom-role grants when checking `manage_users`.
- **Invite.** `users.role` is the first unscoped built-in grant, else `viewer`; custom grants are inserted alongside it.

### 3.4 Migration from the current map

1. Migration 044 creates tables; no data rows.
2. Backfill: one `user_role_scopes` row per user `(users.role, null, null)`; `ai_reviewer` → `analyst`; `manager` → `programme_lead`; others keep their key (legacy keys valid). `users.role` is rewritten to the persona key in the same step; a `users.role_legacy` column is **not** added — the old key is in `audit_log.details`.
3. `tenants.default_role` values mapped the same way.
4. `users.permissions` JSONB (per-object approve rights) is read by `can_approve_for_object` as today and additionally shown in the effective-permissions viewer as "Object approvals (legacy)"; wave 14 adds a migration button that converts each entry into a `(data_owner, null, module)` grant and clears the JSONB on confirm.
5. Frontend `lib/api/auth.ts` `Role` union gains the persona keys; `homeHrefForRole` gains `sap_basis → /home/basis`, `programme_lead → /home/lead`, `data_steward|data_owner → /home/steward`.
6. Tests: existing `tests/test_rbac*.py` run unchanged; new cases assert `has_permission(legacy_key, action)` is unchanged for every legacy key and action (a snapshot of today's map is committed as the fixture).

---

## 4. UI — Admin › Roles & access (`/admin/roles`)

InsightHeader (yes, here too): Situation "8 roles, 2 custom; 41 users, 3 without a scope." Changed "2 role changes this week." Why "4 users can approve write-back on all systems." Do next "Review 1 open access request."

Tabs:

- **Roles**: DataTable key `Mono`, name, built-in Pill / custom Pill, users count, last changed, actions ⋯ (Clone, Edit, Delete for custom). Row click → matrix editor Drawer (lg): resource rows × action columns of `Checkbox`; built-ins read-only with "Clone to edit" button; custom roles editable with a diff strip at the top ("+3 −1 vs programme_lead"). Save → `PUT /roles/{key}/permissions`, toast, audit row. Scope-insensitive resources show a lock icon with tooltip "Tenant-wide; scope does not apply."
- **Users & scopes**: DataTable email, name, grants as Pills (`programme_lead · all`, `data_steward · PRD / material_master`), status. Row Drawer: grants list with add (`Select` role, `Select` system or all, `Select` module or all), remove; **Effective permissions** viewer: a `Select` system/module pair and the resulting matrix with each granted cell showing which grant produced it on hover. Legacy JSONB object approvals shown with "Convert to grants".
- **Invite**: Drawer: email, name, grants (same picker, at least one), message; `POST /users/invite`. Accept-invite page (auth, spec §6) shows the granted roles and scopes before the password form.
- **Requests**: open `access_requests` with user, resource/action, scope, reason, age; Grant (opens grants picker prefilled) / Decline with reason.
- **History**: `audit?action=role.*|grant.*` DataTable with before/after diff popover.

Empty states: Roles never empty (built-ins). Users & scopes empty: "No users yet. Invite the first one." Requests: "No open requests." History: "No role changes yet."

---

## 5. Persona-aware UI

- **Home**: `homeHrefForRole` from `/me/permissions.home`.
- **Nav**: `lib/nav.ts` items carry `requires: {resource, action}`; `Rail` filters by `/me/permissions.resources`. Admin group hidden entirely without any `users ★ | llm ★ | licence V | audit V`.
- **Actions**: buttons/menu items absent when the permission is missing (not greyed). Exception: a primary action a persona would expect to exist (Approve, Write back, Sign off, Extract now) renders disabled with a tooltip "Needs data_owner on PRD — Request access" linking to the request flow; everything else is absent.
- **Request access**: Dialog from the tooltip or from any 403 (`request_access: true`): shows resource/action/scope prefilled, reason field, submit → `POST /access-requests`; toast "Request sent to admins"; admins get a Notification and an Inbox › Approvals item.
- **Viewer/auditor**: every page read-only; DataTables hide `BulkBar`; exports allowed for auditor only.
- **Scoped users**: `RunSelector` and system filters list only systems in scope; objects outside the module scope are hidden from `/objects` and the heatmap; a top-bar `Pill` "Scoped: PRD · material_master" is shown when any grant is scoped.

---

## 6. Build waves (appended to spec.md §10)

| # | Wave | Files | Acceptance |
|---|---|---|---|
| 13 | **RBAC backend** | `api/services/rbac.py` (§3.2), `db/schema.py` (+4 models), `db/migrations/versions/044_rbac_scopes.py`, `api/routes/roles.py` (new), `api/routes/me.py` (new, `/me/permissions`), `api/routes/users.py` (invite grants), `api/routes/auth.py` (`home`), `tests/test_rbac_legacy_snapshot.py`, `tests/test_rbac_scopes.py` | Snapshot test proves every legacy (role, action) unchanged; existing rbac tests pass untouched; `/me/permissions` returns shape §3.3; scoped check denies cross-system access; backfill runs on a copy of a seeded DB; nothing more permissive. |
| 14 | **Scope rollout + migration** | the ten route modules named in §3.2 (`scope=scope_from_path`), `api/services/rbac.py` (`scope_from_path`), JSONB conversion endpoint | e2e: steward scoped to system A gets 403 with `request_access` on system B endpoints; all other routes unaffected; conversion endpoint clears `users.permissions` only after grants exist. |
| 15 | **Admin › Roles & access UI** | `app/(app)/admin/roles/**`, `lib/api/roles.ts`, `lib/api/me.ts`, `components/admin/role-matrix.tsx`, `components/admin/grants-picker.tsx`, `components/admin/effective-permissions.tsx`, `admin/users` invite Drawer, `app/accept-invite` grants preview | Matrix editor round-trips; clone/edit/delete custom role; grants add/remove; effective viewer matches `/users/{id}/effective`; history tab shows audit rows; empty states per §4; axe clean; `lint:tokens` green. |
| 16 | **Persona gating + request access** | `lib/nav.ts` (`requires`), `design/shell/Rail.tsx`, `lib/permissions.tsx` (`usePermissions`, `<Can resource action scope>`), every page's action bars, `components/request-access-dialog.tsx`, 403 handler in `lib/api/client.ts`, `RunSelector` scope filter | Viewer sees no mutating controls (DOM assertion per route in e2e); disabled-with-tooltip only for the four named primaries; 403 opens the request Dialog; scoped Pill appears for scoped users; legacy-role users see identical nav to today. |
