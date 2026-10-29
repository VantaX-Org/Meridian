"use client";

import { useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as ent from "@/lib/api/v2/enterprise";
import type { ComplianceSettings, ScimGroupRoles, TenantTheme } from "@/lib/api/v2/enterprise";
import { formatDate } from "@/lib/format";
import { refreshAdmin, useRoles } from "@/lib/v2/admin-queries";
import { useCompliance, useScimGroupRoles, useScimToken, useThemeSettings } from "@/lib/v2/enterprise-queries";
import { fixed } from "@/lib/v2/format";
import { checkAccent, isHex, MIN_CONTRAST, productName, refreshTenantTheme } from "@/lib/v2/theme";
import { Mark } from "../marks";
import { Mono } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { Block, Confirm, Fld, Kv, Loaded, Note, StatusWord, copyText, since, useCan } from "./kit";
import { t as tr } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";

/* ── Appearance ── */

/** The largest logo the form takes: it travels as a data URL in the theme document. */
export const LOGO_MAX_BYTES = 256 * 1024;
const LOGO_TYPES = ["image/png", "image/svg+xml", "image/jpeg", "image/webp"];

const ratioText = (r: number): string => `${fixed(r, 2)}:1`;

/** The contrast result as numbers against both grounds, and whether the accent may be saved. */
export function ContrastResult({ accent }: { accent: string }) {
  const c = checkAccent(accent);
  if (!c) return <p className="m2-prov" role="alert">{tr("Write the accent as # and six hexadecimal digits, for example the colour picker gives.")}</p>;
  return (
    <div data-testid="contrast-result">
      <dl className="m2-contrast">
        <dt>{tr("On the light ground")}</dt>
        <dd>
          <StatusWord tone={c.light >= MIN_CONTRAST ? "go" : "no-go"}>{`${ratioText(c.light)}, ${c.light >= MIN_CONTRAST ? tr("passes") : tr("below 4.5:1")}`}</StatusWord>
        </dd>
        <dt>{tr("On the dark ground, as chosen")}</dt>
        <dd>{ratioText(c.darkAsChosen)}</dd>
        <dt>{tr("On the dark ground, as used")}</dt>
        <dd>
          <span className="m2-swatch" style={{ "--m2-swatch": c.darkTint } as CSSProperties} aria-hidden="true" /> <Mono>{c.darkTint}</Mono>
          {` ${ratioText(c.dark)}`}
        </dd>
      </dl>
      {c.ok ? (
        <p className="m2-prov">{tr("The dark theme uses the lighter tint so the accent reads at 4.5:1 or better on both grounds.")}</p>
      ) : (
        <p className="m2-prov" role="alert">{tr("Below 4.5:1 on the light ground: links and the primary button would be hard to read. Choose a darker accent.")}</p>
      )}
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error(tr("The file could not be read.")));
    r.readAsDataURL(file);
  });
}

/** The data hue the screen uses now, "#rrggbb", as the starting accent; empty where styles are not computed (tests). */
function currentDataHue(): string {
  if (typeof document === "undefined") return "";
  const root = document.querySelector(".m2-root");
  const v = root ? getComputedStyle(root).getPropertyValue("--m2-data").trim().toLowerCase() : "";
  return isHex(v) ? v : "";
}

function AppearanceForm({ initial, write }: { initial: TenantTheme; write: boolean }) {
  const qc = useQueryClient();
  const { outcome, pending, run } = useOutcome("appearance");
  const [logo, setLogo] = useState<string | null>(initial.logo_url);
  const [name, setName] = useState(initial.product_name ?? "");
  const [useAccent, setUseAccent] = useState(Boolean(initial.accent));
  const [accent, setAccent] = useState(() => initial.accent ?? currentDataHue());
  const [picker, setPicker] = useState(() => initial.accent ?? currentDataHue());
  const [logoError, setLogoError] = useState<string | null>(null);
  const check = useAccent ? checkAccent(accent) : null;
  const nameOk = name.trim().length <= 60;
  const accentOk = !useAccent || Boolean(check?.ok);
  const body: TenantTheme = { logo_url: logo, product_name: name.trim() || null, accent: useAccent ? accent.toLowerCase() : null };
  const onFile = async (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoError(tr("Choose a PNG, SVG, JPEG or WebP image."));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(tr("The logo is {ceil} KB; the limit is 256 KB.", { ceil: Math.ceil(file.size / 1024) }));
      return;
    }
    setLogo(await readAsDataUrl(file));
  };
  const save = (key: string, doc: TenantTheme, title: string) =>
    void run(key, async () => {
      const saved = await ent.putThemeSettings(doc);
      refreshTenantTheme(saved);
      await refreshAdmin(qc, "theme");
      return { tone: "ok", title, detail: tr("Everyone sees it on their next page; the sign-in page shows the logo and name.") };
    });
  const previewStyle = check?.ok ? ({ "--m2-tenant-accent": accent, "--m2-tenant-accent-dark": check.darkTint } as CSSProperties) : undefined;
  return (
    <>
      <div className="m2-fgrid">
        <Fld label={tr("Logo")} hint={tr("PNG, SVG, JPEG or WebP, 256 KB at most. It replaces the mark in the top bar and on the sign-in page.")} error={logoError}>
          <input type="file" accept={LOGO_TYPES.join(",")} disabled={!write} onChange={(e) => void onFile(e.target.files?.[0])} />
        </Fld>
        <Fld label={tr("Product name")} hint={tr("Shown beside the logo. Empty keeps Meridian.")} error={nameOk ? null : tr("60 characters at most")}>
          <input type="text" value={name} maxLength={80} disabled={!write} onChange={(e) => setName(e.target.value)} placeholder={tr("Meridian")} />
        </Fld>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="m2-sw">
          <input type="checkbox" checked={useAccent} disabled={!write} onChange={(e) => setUseAccent(e.target.checked)} />
          <span>{tr("Use our own accent colour")}</span>
        </label>
      </div>
      {useAccent ? (
        <div className="m2-fgrid" style={{ marginTop: 8 }}>
          <Fld label={tr("Accent")} hint={tr("Links, the selected cell, the current run and the primary button.")} mono>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" aria-label={tr("Accent, colour picker")} value={picker} disabled={!write} onChange={(e) => (setAccent(e.target.value), setPicker(e.target.value))} style={{ width: 44, padding: 2 }} />
              <input type="text" aria-label={tr("Accent, hexadecimal")} value={accent} disabled={!write} onChange={(e) => {
                  const v = e.target.value.trim();
                  setAccent(v);
                  if (isHex(v)) setPicker(v.toLowerCase());
                }} spellCheck={false} />
            </span>
          </Fld>
          <div className="m2-wide">
            <ContrastResult accent={accent} />
          </div>
        </div>
      ) : null}
      <h3 className="m2-h2" style={{ marginTop: 16, fontSize: 13 }}>{tr("Preview")}</h3>
      <div className="m2-preview" data-accent={previewStyle ? "" : undefined} style={previewStyle} data-testid="appearance-preview">
        {/* eslint-disable-next-line @next/next/no-img-element -- the chosen file as a data URL, before it is saved */}
        {logo ? <img src={logo} alt={tr("Logo preview")} className="m2-logo" /> : <Mark size={28} />}
        <span className="m2-preview-bn">{productName(body)}</span>
        <span className="m2-btn m2-next" aria-hidden="true">
          {tr("Next step")}
        </span>
        <span className="m2-preview-link">{tr("A link")}</span>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {write ? (
        <div className="m2-adm-acts">
          <button type="button" className="m2-btn m2-strong" disabled={pending !== null || !nameOk || !accentOk} onClick={() => save("save", body, tr("Appearance saved"))}>
            {pending === "save" ? tr("Saving…") : tr("Save the appearance")}
          </button>
          {logo ? (
            <button type="button" className="m2-btn m2-ghost" onClick={() => setLogo(null)}>
              {tr("Remove the logo")}
            </button>
          ) : null}
          <button type="button" className="m2-btn m2-ghost" disabled={pending !== null} onClick={() => (setLogo(null), setName(""), setUseAccent(false), save("reset", { logo_url: null, product_name: null, accent: null }, tr("Meridian's own look restored")))}>
            {tr("Use Meridian's own look")}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Admin › Settings › Appearance: the tenant's logo, product name and accent, with the contrast checked before saving. */
export function AppearanceBlock() {
  const can = useCan();
  const write = can("manage_settings");
  const q = useThemeSettings();
  return (
    <Block id="appearance" title={tr("Appearance")} hint={tr("Your logo, product name and accent, applied for everyone in this tenant and on the sign-in page. The Meridian mark stays under About in the account menu.")}>
      <Loaded q={q} what={tr("The appearance")} rows={3}>
        {(th) => <AppearanceForm key={JSON.stringify(th)} initial={th} write={write} />}
      </Loaded>
    </Block>
  );
}

/* ── Compliance ── */

const FAMILY: Record<string, string> = { get runs() { return tr("Analysis runs"); }, get reports() { return tr("Reports"); }, get audit() { return tr("Audit log"); }, get diagnostics() { return tr("Diagnostics bundles"); }, get findings() { return tr("Findings"); }, get backups() { return tr("Backups"); } };
const familyLabel = (f: string): string => FAMILY[f] ?? labelText(f);

function ComplianceForm({ data, write }: { data: ComplianceSettings; write: boolean }) {
  const qc = useQueryClient();
  const { outcome, pending, run } = useOutcome("compliance");
  const [days, setDays] = useState<Record<string, string>>(() => Object.fromEntries(data.retention.map((r) => [r.family, String(r.days)])));
  const valid = (v: string) => /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 3650;
  const ok = data.retention.every((r) => valid(days[r.family] ?? ""));
  const changed = data.retention.some((r) => String(r.days) !== (days[r.family] ?? "").trim());
  return (
    <>
      <Kv
        rows={[
          [tr("Data residency"), `${data.residency.host}${data.residency.region ? `, ${data.residency.region}` : ""}`],
          [tr("Encryption at rest"), data.encryption_at_rest == null ? tr("Not reported by this deployment") : data.encryption_at_rest ? tr("On") : tr("Off")],
          [tr("Last backup"), data.last_backup_at ? `${formatDate(data.last_backup_at, "datetime")} (${since(data.last_backup_at)})` : tr("No backup recorded")],
        ]}
      />
      {data.encryption_at_rest === false ? <Note tone="warn">{tr("Encryption at rest is off. Turn it on in the database and storage configuration of this deployment.")}</Note> : null}
      <div className="m2-frame" tabIndex={0} role="region" aria-label={tr("Retention by kind of data")} style={{ marginTop: 12, maxWidth: 520 }}>
        <table className="m2-tbl">
          <thead>
            <tr>
              <th scope="col">{tr("Kind of data")}</th>
              <th scope="col">{tr("Kept for, days")}</th>
            </tr>
          </thead>
          <tbody>
            {data.retention.map((r) => (
              <tr key={r.family}>
                <th scope="row">{familyLabel(r.family)}</th>
                <td>
                  {write ? (
                    <input className="m2-inp" type="number" min={1} max={3650} step={1} aria-label={tr("{familyLabel}, days kept", { familyLabel: familyLabel(r.family) })} aria-invalid={!valid(days[r.family] ?? "")} value={days[r.family] ?? ""} onChange={(e) => setDays({ ...days, [r.family]: e.target.value })} />
                  ) : (
                    r.days
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ok ? <p className="m2-prov" role="alert">{tr("Each kind of data is kept from 1 to 3650 days.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {write ? (
        <div className="m2-adm-acts">
          <button
            type="button"
            className="m2-btn"
            disabled={!ok || !changed || pending !== null}
            onClick={() =>
              void run("save", async () => {
                await ent.putCompliance({ ...data, retention: data.retention.map((r) => ({ family: r.family, days: Number(days[r.family]) })) });
                await refreshAdmin(qc, "compliance");
                return { tone: "ok", title: tr("Retention saved"), detail: tr("The nightly task applies it from tonight.") };
              })
            }
          >
            {pending === "save" ? tr("Saving…") : tr("Save retention")}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Admin › Settings › Compliance: where the data lives, whether it is encrypted, the last backup, and how long each kind is kept. */
export function ComplianceBlock() {
  const can = useCan();
  const q = useCompliance();
  return (
    <Block id="compliance" title={tr("Compliance")} hint={tr("Where this deployment keeps its data, whether it is encrypted at rest, the last backup, and how long each kind of data is kept.")}>
      <Loaded q={q} what={tr("The compliance settings")} rows={3}>
        {(c) => <ComplianceForm key={JSON.stringify(c.retention)} data={c} write={can("manage_settings")} />}
      </Loaded>
    </Block>
  );
}

/* ── Diagnostics ── */

/** Admin › System: the bundle support asks for, as one zip. */
export function DiagnosticsBlock() {
  const { outcome, pending, run } = useOutcome();
  return (
    <Block title={tr("Support")} hint={tr("The diagnostics bundle holds versions, health checks, recent errors and configuration with every secret removed. It holds no SAP record values.")}>
      <div className="m2-adm-acts" style={{ marginTop: 0 }}>
        <button
          type="button"
          className="m2-btn"
          disabled={pending !== null}
          onClick={() =>
            void run("zip", async () => {
              const file = await ent.downloadDiagnostics();
              return { tone: "ok", title: tr("Saved {file}", { file }), detail: tr("Attach it to your support request.") };
            })
          }
        >
          {pending === "zip" ? tr("Preparing…") : tr("Download diagnostics bundle")}
        </button>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </Block>
  );
}

/* ── SCIM ── */

/** The secret, once: copy it now, Meridian keeps only a hash. */
function OneTimeSecret({ token, onDone }: { token: string; onDone: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="m2-note" data-tone="warn" data-testid="scim-secret">
      <p style={{ margin: 0 }}>{tr("Shown once. Copy the token now and paste it into your identity provider: Meridian keeps only a hash of it.")}</p>
      <p className="m2-secret" aria-label={tr("SCIM token")}>{token}</p>
      <div className="m2-adm-acts" style={{ marginTop: 8 }}>
        <button type="button" className="m2-btn" onClick={() => void copyText(token).then(setCopied)}>
          {copied ? tr("Copied") : tr("Copy the token")}
        </button>
        <button type="button" className="m2-btn m2-ghost" onClick={onDone}>
          {tr("I have stored it")}
        </button>
      </div>
      {copied === false ? <p className="m2-prov" role="alert">{tr("The browser did not allow copying. Select the token and copy it by hand.")}</p> : null}
    </div>
  );
}

/** Admin › Users › Provisioning: the SCIM token (create, rotate, revoke), when it was last used, and the base URL. */
export function ScimCard() {
  const can = useCan();
  const qc = useQueryClient();
  const write = can("manage_users");
  const q = useScimToken(write);
  const { outcome, pending, run } = useOutcome();
  const [secret, setSecret] = useState<string | null>(null);
  const [ask, setAsk] = useState<"rotate" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);
  const base = ent.scimBaseUrl(typeof window === "undefined" ? "" : window.location.origin);
  if (!write) return null;
  const create = (rotate: boolean) =>
    run(rotate ? "rotate" : "create", async () => {
      const t = await ent.createScimToken();
      setAsk(null);
      setSecret(t.token ?? null);
      await refreshAdmin(qc, "scim");
      return { tone: "ok", title: rotate ? tr("Token rotated") : tr("Token created"), detail: rotate ? tr("The previous token stopped working. Paste the new one into your identity provider.") : tr("Paste it into your identity provider with the base URL.") };
    });
  return (
    <section className="m2-adm-blk" aria-labelledby="m2-scim-h" data-testid="scim-card">
      <h2 id="m2-scim-h">{tr("Provisioning (SCIM)")}</h2>
      <p className="m2-adm-hint">{tr("Microsoft Entra ID, Okta and other identity providers create, update and suspend people here through SCIM 2.0. Give them the base URL and a token.")}</p>
      <Loaded q={q} what={tr("The SCIM token")} rows={2}>
        {(t) => {
          const state = !t.created_at ? "none" : t.revoked ? "revoked" : "active";
          return (
            <>
              <Kv
                rows={[
                  [tr("Token"), <StatusWord key="s" tone={state === "active" ? "go" : state === "revoked" ? "no-go" : "neutral"}>{state === "active" ? tr("Active") : state === "revoked" ? tr("Revoked") : tr("Not created yet")}</StatusWord>],
                  [tr("Created"), t.created_at ? formatDate(t.created_at, "datetime") : "—"],
                  [tr("Last used"), t.created_at ? since(t.last_used_at) : "—"],
                  [
                    tr("SCIM base URL"),
                    <span key="u" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Mono>{base}</Mono>
                      <button type="button" className="m2-btn m2-sm" onClick={() => void copyText(base).then(setCopied)}>
                        {copied ? tr("Copied") : tr("Copy the URL")}
                      </button>
                    </span>,
                  ],
                ]}
              />
              {secret ? <OneTimeSecret token={secret} onDone={() => setSecret(null)} /> : null}
              {outcome ? <ResultFrame outcome={outcome} /> : null}
              <div className="m2-adm-acts">
                {state === "active" ? (
                  <>
                    <button type="button" className="m2-btn" disabled={pending !== null} onClick={() => setAsk("rotate")}>
                      {tr("Rotate the token")}
                    </button>
                    <button type="button" className="m2-btn m2-crit" disabled={pending !== null} onClick={() => setAsk("revoke")}>
                      {tr("Revoke")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={() => void create(false)}>
                    {pending === "create" ? tr("Creating…") : tr("Create a token")}
                  </button>
                )}
              </div>
              {ask === "rotate" ? (
                <Confirm title={tr("Rotate the SCIM token")} body={tr("The current token stops working at once. Until the new one is in your identity provider, nobody is provisioned or suspended.")} confirm={tr("Rotate")} pending={pending === "rotate"} onCancel={() => setAsk(null)} onConfirm={() => void create(true)} />
              ) : null}
              {ask === "revoke" ? (
                <Confirm
                  title={tr("Revoke the SCIM token")}
                  body={tr("Provisioning stops. People already provisioned keep their accounts; changes in the identity provider stop reaching Meridian.")}
                  confirm={tr("Revoke")}
                  danger
                  pending={pending === "revoke"}
                  onCancel={() => setAsk(null)}
                  onConfirm={() =>
                    void run("revoke", async () => {
                      await ent.revokeScimToken();
                      setAsk(null);
                      setSecret(null);
                      await refreshAdmin(qc, "scim");
                      return { tone: "info", title: tr("Token revoked"), detail: tr("Create a new token to start provisioning again.") };
                    })
                  }
                />
              ) : null}
            </>
          );
        }}
      </Loaded>
      <GroupRoles />
    </section>
  );
}

/** Which identity-provider group gives which role. A person in no mapped group keeps the role they were given here. */
function GroupRoles() {
  const q = useScimGroupRoles();
  return (
    <div style={{ marginTop: 16 }}>
      <h3 className="m2-h2" style={{ fontSize: 13 }}>{tr("Group to role")}</h3>
      <p className="m2-adm-hint">{tr("A person provisioned in one of these groups gets its role. Someone in no mapped group keeps the role given here.")}</p>
      <Loaded q={q} what={tr("The group mapping")} rows={3}>
        {(m) => <GroupRoleEditor key={JSON.stringify(m)} initial={m} />}
      </Loaded>
    </div>
  );
}

export function GroupRoleEditor({ initial }: { initial: ScimGroupRoles }) {
  const qc = useQueryClient();
  const roles = useRoles().data ?? [];
  const { outcome, pending, run } = useOutcome("scim-groups");
  const [rows, setRows] = useState(initial.map.map((r, i) => ({ ...r, id: i })));
  const [seq, setSeq] = useState(initial.map.length);
  const names = rows.map((r) => r.group.trim().toLowerCase());
  const dupes = new Set(names.filter((n, i) => n && names.indexOf(n) !== i));
  const empty = rows.some((r) => !r.group.trim());
  const ok = !empty && dupes.size === 0;
  const roleOptions = roles.length ? roles : [{ key: "viewer", name: tr("Viewer") }];
  return (
    <>
      <div className="m2-frame" tabIndex={0} role="region" aria-label={tr("Group to role mapping")} style={{ maxWidth: 640 }}>
        <table className="m2-tbl m2-maptbl">
          <thead>
            <tr>
              <th scope="col">{tr("Identity provider group")}</th>
              <th scope="col">{tr("Role in Meridian")}</th>
              <th scope="col">
                <span className="m2-sr">{tr("Remove")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>
                  <input type="text" aria-label={tr("Group {count}", { count: i + 1 })} aria-invalid={!r.group.trim() || dupes.has(r.group.trim().toLowerCase())} value={r.group} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, group: e.target.value } : x)))} />
                </td>
                <td>
                  <select aria-label={tr("Role for group {count}", { count: i + 1 })} value={r.role} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, role: e.target.value } : x)))}>
                    {roleOptions.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button type="button" className="m2-btn m2-sm m2-ghost" aria-label={tr("Remove group {count}", { count: i + 1 })} onClick={() => setRows(rows.filter((x) => x.id !== r.id))}>
                    {tr("Remove")}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3}>{tr("No group is mapped. Everyone provisioned keeps the role given here.")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {empty ? <p className="m2-prov" role="alert">{tr("Every row needs a group name.")}</p> : null}
      {dupes.size ? <p className="m2-prov" role="alert">{tr("A group can map to one role only.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button type="button" className="m2-btn" onClick={() => (setRows([...rows, { id: seq, group: "", role: roleOptions[roleOptions.length - 1].key }]), setSeq(seq + 1))}>
          {tr("Add a group")}
        </button>
        <button
          type="button"
          className="m2-btn m2-strong"
          disabled={!ok || pending !== null}
          onClick={() =>
            void run("save", async () => {
              await ent.putScimGroupRoles({ map: rows.map(({ group, role }) => ({ group: group.trim(), role })) });
              await refreshAdmin(qc, "scim");
              return { tone: "ok", title: tr("Mapping saved"), detail: tr("It applies the next time the identity provider sends a change.") };
            })
          }
        >
          {pending === "save" ? tr("Saving…") : tr("Save the mapping")}
        </button>
      </div>
    </>
  );
}

/** "Provisioned by SCIM" beside a person who came from the identity provider. */
export function ScimBadge({ user }: { user: object }) {
  return ent.provisionedByScim(user) ? (
    <span className="m2-badge2" data-testid="scim-badge">
      {tr("Provisioned by SCIM")}
    </span>
  ) : null;
}
