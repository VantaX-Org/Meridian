"use client";

/** Pieces shared by the people inspector bodies (user, role, API key, audit entry, channel). */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { User } from "@/types/api";
import type { ApiKey } from "@/lib/api/api-keys";
import type { Matrix, Role } from "@/lib/api/roles";
import { getOidcPublicConfig } from "@/lib/api/sso";
import { errorSentence } from "@/lib/api/v2/client";
import { fixtureActive } from "@/lib/api/v2/fixture";
import { writeClipboard } from "@/lib/browser";
import { failureText } from "@/lib/v2/errors";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { roleText, userStatusText } from "@/lib/v2/labels";
import { userStatus } from "@/lib/users";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { Chip, useToast, type ChipTone } from "../../kit";
import "./people.css";

export interface Outcome {
  tone: "ok" | "info" | "fail";
  title: string;
  detail?: string;
}

/** One action at a time: `run(key, fn)` marks the key pending, then keeps what `fn` returned, or the API's sentence. */
export function useOutcome(): { outcome: Outcome | null; pending: string | null; run: (key: string, fn: () => Promise<Outcome>) => Promise<void> } {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (key: string, fn: () => Promise<Outcome>) => {
    setPending(key);
    setOutcome(null);
    try {
      const next = await fn();
      if (alive.current) setOutcome(next);
    } catch (e) {
      if (alive.current) setOutcome({ tone: "fail", title: t("It did not go through"), detail: failureText(e) });
    } finally {
      if (alive.current) setPending(null);
    }
  }, []);
  return { outcome, pending, run };
}

export function OutcomeView({ outcome }: { outcome: Outcome }) {
  return (
    <div className="nx-pp-result" role="status" data-tone={outcome.tone} data-testid="action-result">
      <Chip tone={outcome.tone === "ok" ? "good" : outcome.tone === "fail" ? "bad" : "neutral"}>{outcome.title}</Chip>
      {outcome.detail ? <span>{outcome.detail}</span> : null}
    </div>
  );
}

/** A sentence beside an action, in the quiet face. */
export function Note({ children, id, role }: { children: ReactNode; id?: string; role?: string }) {
  return (
    <p className="nx-ib-meta nx-pp-note" id={id} role={role}>
      {children}
    </p>
  );
}

export function Sec({ title, children, label }: { title: string; children: ReactNode; label?: string }) {
  return (
    <section className="nx-ib-sec" aria-label={label}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export const copyText = (s: string): Promise<boolean> => writeClipboard(s);
export const since = (iso: string | null | undefined, never = t("Never")): string => (iso ? relTime(iso) : never);

/** A toast with Undo, the v2 `done(label, undo)`. */
export function useDone(): (label: string, undo?: () => Promise<void>) => void {
  const toast = useToast();
  return (label, undo) => toast({ text: label, onUndo: undo ? () => void undo() : undefined });
}

/* ── Users ── */

const STATUS_TONE: Record<ReturnType<typeof userStatus>, ChipTone> = { active: "good", invited: "warn", invite_expired: "bad", locked: "bad", suspended: "neutral" };

export function UserStatusWord({ user }: { user: User }) {
  const s = userStatus(user);
  return <Chip tone={STATUS_TONE[s]}>{userStatusText(s)}</Chip>;
}

/** The roles a person holds, once each by name, in grant order; before any grant, the role on the account. */
function userRoles(u: User): { key: string; name: string }[] {
  const byName = new Map<string, string>();
  for (const g of u.grants ?? []) {
    const name = (g.role_name || roleText(g.role_key)).replace(/\s*\(legacy\)\s*$/i, "");
    if (!byName.has(name)) byName.set(name, g.role_key);
  }
  return byName.size ? Array.from(byName, ([name, key]) => ({ key, name })) : [{ key: u.role, name: roleText(u.role) }];
}
export const roleNames = (u: User): string => userRoles(u).map((r) => r.name).join(", ");

/** True when the tenant enforces single sign-on (public config, so any signed-in user can read it). */
export function useSsoEnforced(): boolean {
  const q = useQuery({
    queryKey: ["oidc-public", fixtureActive()],
    queryFn: () => (fixtureActive() ? Promise.resolve({ enabled: false, display_name: null, enforce: false }) : getOidcPublicConfig()),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return Boolean(q.data?.enabled && q.data.enforce);
}

/** The sentence for a refused password request, by status; the API's own sentence when it gave one. */
export function passwordFailure(e: unknown): Outcome {
  const status = isAxiosError(e) ? e.response?.status : undefined;
  if (status === 429) return { tone: "fail", title: t("Too many password changes"), detail: t("Wait a minute, then try again.") };
  if (status === 403) return { tone: "fail", title: t("Not allowed"), detail: errorSentence(e, t("Setting a password needs the manage users permission.")) };
  if (status === 422) return { tone: "fail", title: t("That password cannot be used"), detail: errorSentence(e, t("Choose a stronger password.")) };
  return { tone: "fail", title: t("The password was not changed"), detail: errorSentence(e, t("Try again.")) };
}

/* ── Roles ── */

export const matrixToPairs = (m: Matrix): { resource: string; action: string }[] =>
  Object.entries(m).flatMap(([resource, acts]) =>
    Object.entries(acts)
      .filter(([, on]) => on)
      .map(([action]) => ({ resource, action })),
  );

export function PermissionMatrix({ matrix, editable, base, onToggle }: { matrix: Matrix; editable: boolean; base?: Matrix; onToggle?: (resource: string, action: string, on: boolean) => void }) {
  const resources = Object.keys(matrix);
  const actions = Object.keys(matrix[resources[0]] ?? {});
  return (
    <div className="nx-pp-scroll" tabIndex={0}>
      <table className="nx-pp-table" aria-label={t("Permissions by resource and action")}>
        <thead>
          <tr>
            <th scope="col">{t("Resource")}</th>
            {actions.map((a) => (
              <th key={a} scope="col">
                {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r}>
              <td>{r}</td>
              {actions.map((a) => {
                const on = !!matrix[r][a];
                const changed = base ? !!base[r]?.[a] !== on : false;
                return (
                  <td key={a} data-changed={changed ? "true" : undefined}>
                    {editable ? (
                      <input type="checkbox" checked={on} aria-label={`${r} ${a}`} onChange={(e) => onToggle?.(r, a, e.target.checked)} />
                    ) : on ? (
                      <span aria-label={t("{r} {a}: allowed", { r, a })}>{t("Yes")}</span>
                    ) : (
                      <span className="nx-pp-dash" aria-label={t("{r} {a}: not allowed", { r, a })}>
                        {"—"}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── API keys ── */

export const keyRoles = (k: ApiKey): string =>
  k.grants.length === 0 ? t("No roles") : k.grants.map((g) => `${g.role_name}${g.system_name ? `, ${g.system_name}` : ""}${g.module ? `, ${g.module}` : ""}`).join("; ");

/* ── A scope picker shared by grants and API keys ── */

export interface Scope {
  role: string;
  system: string;
  module: string;
}

export function ScopeFields({ scope, onChange, roles, expires, onExpires }: { scope: Scope; onChange: (s: Scope) => void; roles: Role[]; expires?: string; onExpires?: (v: string) => void }) {
  const systems = useSystemsExtended();
  const landscape = useLandscape(null);
  return (
    <div className="nx-pp-form">
      <label className="nx-field">
        {t("Role")}
        <select className="nx-input" value={scope.role} onChange={(e) => onChange({ ...scope, role: e.target.value })}>
          <option value="">{t("Choose a role")}</option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label className="nx-field">
        {t("System")}
        <select className="nx-input" value={scope.system} onChange={(e) => onChange({ ...scope, system: e.target.value })}>
          <option value="">{t("All systems")}</option>
          {(systems.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="nx-field">
        {t("Object")}
        <select className="nx-input" value={scope.module} onChange={(e) => onChange({ ...scope, module: e.target.value })}>
          <option value="">{t("All objects")}</option>
          {(landscape.data?.objects ?? []).map((o) => (
            <option key={o.module} value={o.module}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {onExpires ? (
        <label className="nx-field">
          {t("Expires (optional)")}
          <input className="nx-input" type="date" value={expires ?? ""} onChange={(e) => onExpires(e.target.value)} />
        </label>
      ) : null}
    </div>
  );
}

export const grantBody = (s: Scope, expires?: string) => ({ role_key: s.role, system_id: s.system || null, module: s.module || null, ...(expires ? { expires_at: `${expires}T23:59:59Z` } : {}) });
