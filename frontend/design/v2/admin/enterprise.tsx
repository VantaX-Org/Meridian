"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as ent from "@/lib/api/v2/enterprise";
import type { ComplianceStatement, RetentionInput, ScimMappings, ThemeSettings } from "@/lib/api/v2/enterprise";
import { formatDate } from "@/lib/format";
import { refreshAdmin, useRoles } from "@/lib/v2/admin-queries";
import { useCompliance, useScimGroupRoles, useScimToken, useThemeSettings } from "@/lib/v2/enterprise-queries";
import { fixed } from "@/lib/v2/format";
import { checkAccent, darkAccentFor, isHex, MIN_CONTRAST, refreshTenantTheme } from "@/lib/v2/theme";
import { Mark } from "../marks";
import { Mono } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { Block, Confirm, Fld, Kv, Loaded, Note, StatusWord, copyText, since, useCan } from "./kit";
import { t as tr } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";

/* ── Appearance (GET/PUT /settings/theme, POST /settings/theme/logo) ── */

const ratioText = (r: number | null | undefined): string => (r == null ? "—" : `${fixed(r, 2)}:1`);
/** The server's product name limit (api/services/theme.py PRODUCT_NAME_MAX). */
const NAME_MAX = 40;

/** The contrast of the chosen accents, before saving: the server checks the same pairs again and has the last word. */
export function ContrastResult({ accent, accentDark }: { accent: string; accentDark: string }) {
  const c = checkAccent(accent);
  if (!c) return <p className="m2-prov" role="alert">{tr("Write the accent as # and six hexadecimal digits, for example the colour picker gives.")}</p>;
  const dark = accentDark.trim() ? (isHex(accentDark) ? accentDark.trim().toUpperCase() : null) : null;
  return (
    <div data-testid="contrast-result">
      <dl className="m2-contrast">
        <dt>{tr("Accent on the light ground")}</dt>
        <dd>
          <StatusWord tone={c.light >= MIN_CONTRAST ? "go" : "no-go"}>{`${ratioText(c.light)}, ${c.light >= MIN_CONTRAST ? tr("passes") : tr("below 4.5:1")}`}</StatusWord>
        </dd>
        <dt>{tr("Dark-mode accent")}</dt>
        <dd>{dark ? <Mono>{dark}</Mono> : accentDark.trim() ? tr("Not a hex colour") : tr("Derived by the server from the accent")}</dd>
        {dark ? (
          <>
            <dt>{tr("On the dark ground, as used")}</dt>
            <dd>
              <span className="m2-swatch" style={{ "--m2-swatch": darkAccentFor(dark) } as CSSProperties} aria-hidden="true" /> <Mono>{darkAccentFor(dark)}</Mono>
            </dd>
          </>
        ) : null}
      </dl>
      {c.light >= MIN_CONTRAST ? null : <p className="m2-prov" role="alert">{tr("Below 4.5:1 on the light ground: links and the primary button would be hard to read. Choose a darker accent.")}</p>}
    </div>
  );
}

/** What the server says it stored: the two accents and their contrast, a dash for what it does not have. */
function SavedTheme({ th }: { th: ThemeSettings }) {
  return (
    <Kv
      rows={[
        [tr("Product name"), th.product_name_override ?? "—"],
        [tr("Accent"), th.accent ? <Mono key="a">{`${th.accent}, ${ratioText(th.contrast.on_white)} ${tr("on white")}`}</Mono> : "—"],
        [tr("Dark-mode accent"), th.accent_dark ? <Mono key="d">{`${th.accent_dark}, ${ratioText(th.contrast.on_dark)} ${tr("on the dark ground")}`}</Mono> : "—"],
        [tr("Logo"), th.logo_url ? (th.logo_content_type ?? "—") : "—"],
        [tr("Last changed"), th.updated_at ? formatDate(th.updated_at, "datetime") : "—"],
      ]}
    />
  );
}

/** The data hue the screen uses now, "#rrggbb", as the starting accent; empty where styles are not computed (tests). */
function currentDataHue(): string {
  if (typeof document === "undefined") return "";
  const root = document.querySelector(".m2-root");
  const v = root ? getComputedStyle(root).getPropertyValue("--m2-data").trim().toLowerCase() : "";
  return isHex(v) ? v : "";
}

function AppearanceForm({ initial, write }: { initial: ThemeSettings; write: boolean }) {
  const qc = useQueryClient();
  const { outcome, pending, run } = useOutcome("appearance");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [name, setName] = useState(initial.product_name_override ?? "");
  const [useAccent, setUseAccent] = useState(Boolean(initial.accent));
  const [accent, setAccent] = useState(() => initial.accent ?? currentDataHue());
  const [accentDark, setAccentDark] = useState(initial.accent_dark ?? "");
  const [picker, setPicker] = useState(() => (initial.accent && isHex(initial.accent) ? initial.accent.toLowerCase() : currentDataHue()));
  const [logoError, setLogoError] = useState<string | null>(null);
  useEffect(() => () => {
    if (filePreview && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(filePreview);
  }, [filePreview]);
  const check = useAccent ? checkAccent(accent) : null;
  const cleanName = name.split(/\s+/).filter(Boolean).join(" ");
  const nameOk = cleanName.length <= NAME_MAX && !/[<>]/.test(cleanName);
  const darkOk = !useAccent || !accentDark.trim() || isHex(accentDark);
  const accentOk = !useAccent || (Boolean(check) && (check?.light ?? 0) >= MIN_CONTRAST && darkOk);
  const shownLogo = removeLogo ? null : (filePreview ?? initial.logo_url);
  const onFile = (f: File | undefined) => {
    setLogoError(null);
    if (!f) return;
    if (!(ent.LOGO_TYPES as readonly string[]).includes(f.type)) {
      setLogoError(tr("Choose a PNG or SVG image."));
      return;
    }
    if (f.size > ent.LOGO_MAX_BYTES) {
      setLogoError(tr("The logo is {ceil} KB; the limit is {max} KB.", { ceil: Math.ceil(f.size / 1024), max: ent.LOGO_MAX_BYTES / 1024 }));
      return;
    }
    setFile(f);
    setRemoveLogo(false);
    setFilePreview(typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : null);
  };
  const save = (key: string, reset: boolean) =>
    void run(key, async () => {
      // The logo goes up first, as a file; the theme then names the stored logo (or null to remove it).
      let logoUrl = reset || removeLogo ? null : initial.logo_url;
      if (!reset && file) logoUrl = (await ent.uploadThemeLogo(file)).logo_url;
      await ent.putThemeSettings(
        reset
          ? { product_name_override: null, accent: null, accent_dark: null, logo_url: null }
          : { product_name_override: cleanName || null, accent: useAccent ? accent.trim() : null, accent_dark: useAccent && accentDark.trim() ? accentDark.trim() : null, logo_url: logoUrl },
      );
      refreshTenantTheme();
      await refreshAdmin(qc, "theme");
      return { tone: "ok", title: reset ? tr("Meridian's own look restored") : tr("Appearance saved"), detail: tr("Everyone sees it on their next page; the sign-in page shows the logo and name.") };
    });
  const previewDark = check && check.light >= MIN_CONTRAST ? (accentDark.trim() && isHex(accentDark) ? darkAccentFor(accentDark.trim()) : check.darkTint) : null;
  const previewStyle = previewDark ? ({ "--m2-tenant-accent": accent.trim(), "--m2-tenant-accent-dark": previewDark } as CSSProperties) : undefined;
  return (
    <>
      <SavedTheme th={initial} />
      <div className="m2-fgrid" style={{ marginTop: "var(--m2-s3)" }}>
        <Fld label={tr("Logo")} hint={tr("PNG or SVG, {max} KB at most. It replaces the mark in the top bar and on the sign-in page.", { max: ent.LOGO_MAX_BYTES / 1024 })} error={logoError}>
          <input type="file" accept={ent.LOGO_TYPES.join(",")} disabled={!write} onChange={(e) => onFile(e.target.files?.[0])} />
        </Fld>
        <Fld label={tr("Product name")} hint={tr("Shown beside the logo. Empty keeps Meridian.")} error={nameOk ? null : tr("{max} characters at most, without < or >", { max: NAME_MAX })}>
          <input type="text" value={name} maxLength={80} disabled={!write} onChange={(e) => setName(e.target.value)} placeholder={tr("Meridian")} />
        </Fld>
      </div>
      <div style={{ marginTop: "var(--m2-s3)" }}>
        <label className="m2-sw">
          <input type="checkbox" checked={useAccent} disabled={!write} onChange={(e) => setUseAccent(e.target.checked)} />
          <span>{tr("Use our own accent colour")}</span>
        </label>
      </div>
      {useAccent ? (
        <div className="m2-fgrid" style={{ marginTop: "var(--m2-s2)" }}>
          <Fld label={tr("Accent")} hint={tr("Links, the selected cell, the current run and the primary button. It must read at 4.5:1 on white.")} mono>
            <span style={{ display: "flex", gap: "var(--m2-s2)", alignItems: "center" }}>
              <input type="color" aria-label={tr("Accent, colour picker")} value={picker} disabled={!write} onChange={(e) => (setAccent(e.target.value), setPicker(e.target.value))} style={{ width: 44, padding: "var(--m2-s1)" }} />
              <input type="text" aria-label={tr("Accent, hexadecimal")} value={accent} disabled={!write} onChange={(e) => {
                  const v = e.target.value.trim();
                  setAccent(v);
                  if (isHex(v)) setPicker(v.toLowerCase());
                }} spellCheck={false} />
            </span>
          </Fld>
          <Fld label={tr("Dark-mode accent (optional)")} hint={tr("Empty lets the server derive a lighter tint that reads at 4.5:1 on the dark ground.")} mono error={darkOk ? null : tr("Write it as # and six hexadecimal digits")}>
            <input type="text" value={accentDark} disabled={!write} onChange={(e) => setAccentDark(e.target.value.trim())} spellCheck={false} />
          </Fld>
          <div className="m2-wide">
            <ContrastResult accent={accent} accentDark={accentDark} />
          </div>
        </div>
      ) : null}
      <h3 className="m2-h2" style={{ marginTop: "var(--m2-s4)", fontSize: 13 }}>{tr("Preview")}</h3>
      <div className="m2-preview" data-accent={previewStyle ? "" : undefined} style={previewStyle} data-testid="appearance-preview">
        {/* eslint-disable-next-line @next/next/no-img-element -- the stored logo or the chosen file, before it is uploaded */}
        {shownLogo ? <img src={shownLogo} alt={tr("Logo preview")} className="m2-logo" /> : <Mark size={28} />}
        <span className="m2-preview-bn">{cleanName || tr("Meridian")}</span>
        <span className="m2-btn m2-next" aria-hidden="true">
          {tr("Next step")}
        </span>
        <span className="m2-preview-link">{tr("A link")}</span>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {write ? (
        <div className="m2-adm-acts">
          <button type="button" className="m2-btn m2-strong" disabled={pending !== null || !nameOk || !accentOk} onClick={() => save("save", false)}>
            {pending === "save" ? tr("Saving…") : tr("Save the appearance")}
          </button>
          {shownLogo ? (
            <button type="button" className="m2-btn m2-ghost" onClick={() => (setFile(null), setFilePreview(null), setRemoveLogo(true))}>
              {tr("Remove the logo")}
            </button>
          ) : null}
          <button type="button" className="m2-btn m2-ghost" disabled={pending !== null} onClick={() => (setFile(null), setFilePreview(null), setName(""), setUseAccent(false), save("reset", true))}>
            {tr("Use Meridian's own look")}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Admin › Settings › Appearance: the tenant's logo, product name and accents, with the contrast checked before saving. */
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

/* ── Compliance (GET/PUT /settings/compliance) ── */

/** The families the server names, in the interface's language; an unknown one keeps the server's English label. */
const FAMILY: Record<string, string> = {
  get analysis_versions() { return tr("Analysis runs, findings and work lists"); },
  get reports() { return tr("Generated reports"); },
  get audit_log() { return tr("Audit log"); },
  get health_samples() { return tr("Health samples"); },
  get jobs() { return tr("Job progress"); },
};
const yesNo = (v: boolean | null | undefined): string => (v == null ? "—" : v ? tr("Yes") : tr("No"));
const daysText = (d: number | null): string => (d == null ? tr("Kept for ever") : tr("{d, plural, one {# day} other {# days}}", { d }));

function ComplianceForm({ data, write }: { data: ComplianceStatement; write: boolean }) {
  const qc = useQueryClient();
  const { outcome, pending, run } = useOutcome("compliance");
  const editable = data.retention.families.filter((f) => f.configurable && ent.RETENTION_FIELD[f.family]);
  const [days, setDays] = useState<Record<string, string>>(() => Object.fromEntries(editable.map((f) => [f.family, f.days == null ? "" : String(f.days)])));
  const field = (family: string) => ent.RETENTION_FIELD[family];
  const valid = (family: string, v: string) => {
    if (!v.trim()) return true;
    const n = Number(v);
    return /^\d+$/.test(v.trim()) && n >= ent.RETENTION_MIN[field(family)] && n <= ent.RETENTION_MAX;
  };
  const ok = editable.every((f) => valid(f.family, days[f.family] ?? ""));
  const changed = editable.some((f) => (f.days == null ? "" : String(f.days)) !== (days[f.family] ?? "").trim());
  const res = data.data_residency;
  const enc = data.encryption_at_rest;
  const enf = data.retention.enforcement;
  return (
    <>
      <Kv
        rows={[
          [tr("Deployment"), res.deployment === "customer_hosted" ? tr("Hosted by you: SAP data, findings and reports stay in your environment") : labelText(res.deployment)],
          [tr("Database host"), res.database_host ? <Mono key="db">{res.database_host}</Mono> : "—"],
          [tr("Object storage host"), res.object_storage_host ? <Mono key="os">{res.object_storage_host}</Mono> : "—"],
          [tr("Language model"), res.llm_provider ? `${res.llm_provider}${res.llm_in_deployment == null ? "" : res.llm_in_deployment ? tr(", inside this deployment") : tr(", outside this deployment")}` : "—"],
          [tr("Database volume encrypted at rest"), yesNo(enc.database_volume)],
          [tr("Object storage encrypted at rest"), yesNo(enc.object_storage)],
          [tr("SAP credentials encrypted"), yesNo(enc.sap_credentials)],
          [tr("Language model API keys encrypted"), yesNo(enc.llm_api_keys)],
          [tr("Last backup"), data.backup ? `${formatDate(data.backup.at, "datetime")} (${since(data.backup.at)})` : "—"],
          [
            tr("Deletion"),
            enf.enforced ? tr("Enforced every night") : !enf.flag_enabled ? tr("Off: purging is not enabled on this deployment") : enf.dry_run_until ? tr("Dry run until {date}, then enforced", { date: formatDate(enf.dry_run_until, "date") }) : tr("Dry run, starting tonight"),
          ],
        ]}
      />
      {enc.database_volume === false || enc.object_storage === false ? <Note tone="warn">{tr("Part of the storage is not encrypted at rest. Turn it on in the database and storage configuration of this deployment.")}</Note> : null}
      <p className="m2-prov">{tr("A dash means this deployment does not declare it.")}</p>
      <div className="m2-frame" tabIndex={0} role="region" aria-label={tr("Retention by kind of data")} style={{ marginTop: "var(--m2-s3)", maxWidth: 620 }}>
        <table className="m2-tbl">
          <thead>
            <tr>
              <th scope="col">{tr("Kind of data")}</th>
              <th scope="col">{tr("Kept for")}</th>
            </tr>
          </thead>
          <tbody>
            {data.retention.families.map((f) => {
              const label = FAMILY[f.family] ?? f.label;
              const edit = write && f.configurable && Boolean(field(f.family));
              return (
                <tr key={f.family}>
                  <th scope="row">{label}</th>
                  <td>
                    {edit ? (
                      <input className="m2-inp" type="number" min={ent.RETENTION_MIN[field(f.family)]} max={ent.RETENTION_MAX} step={1} placeholder={tr("For ever")} aria-label={tr("{familyLabel}, days kept", { familyLabel: label })} aria-invalid={!valid(f.family, days[f.family] ?? "")} value={days[f.family] ?? ""} onChange={(e) => setDays({ ...days, [f.family]: e.target.value })} />
                    ) : (
                      <>
                        {daysText(f.days)}
                        {f.configurable ? null : <span className="m2-meta">{` ${tr("(fixed)")}`}</span>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="m2-prov">
        {tr("The baseline run is {kept}; the newest {n, plural, one {run} other {# runs}} of each system {n, plural, one {is} other {are}} always kept.", { kept: data.retention.keep_baseline ? tr("kept") : tr("not kept"), n: data.retention.keep_latest_per_system })}
      </p>
      {!ok ? <p className="m2-prov" role="alert">{tr("Runs and reports are kept from 1 to 3650 days, the audit log from 30; empty keeps them for ever.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {write ? (
        <div className="m2-adm-acts">
          <button
            type="button"
            className="m2-btn"
            disabled={!ok || !changed || pending !== null}
            onClick={() =>
              void run("save", async () => {
                const body: RetentionInput = {};
                for (const f of editable) {
                  const v = (days[f.family] ?? "").trim();
                  body[field(f.family)] = v ? Number(v) : null;
                }
                await ent.putCompliance(body);
                await refreshAdmin(qc, "compliance");
                return { tone: "ok", title: tr("Retention saved"), detail: tr("The nightly task applies it, first as a dry run.") };
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

/** Admin › Settings › Compliance: where the data lives, what is encrypted, the last backup, and how long each kind is kept. */
export function ComplianceBlock() {
  const can = useCan();
  const q = useCompliance();
  return (
    <Block id="compliance" title={tr("Compliance")} hint={tr("Where this deployment keeps its data, what is encrypted at rest, the last backup, and how long each kind of data is kept.")}>
      <Loaded q={q} what={tr("The compliance statement")} rows={3}>
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

/* ── SCIM (GET/POST /admin/scim/token, GET/PUT /admin/scim/group-roles; manage_system) ── */

/** The secret, once: copy it now, Meridian keeps only a hash. */
function OneTimeSecret({ token, onDone }: { token: string; onDone: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="m2-anote" data-tone="warn" data-testid="scim-secret">
      <p style={{ margin: 0 }}>{tr("Shown once. Copy the token now and paste it into your identity provider: Meridian keeps only a hash of it.")}</p>
      <p className="m2-secret" aria-label={tr("SCIM token")}>{token}</p>
      <div className="m2-adm-acts" style={{ marginTop: "var(--m2-s2)" }}>
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
  const write = can("manage_system");
  const q = useScimToken(write);
  const { outcome, pending, run } = useOutcome();
  const [secret, setSecret] = useState<string | null>(null);
  const [ask, setAsk] = useState<"rotate" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);
  if (!write) return null;
  const rotate = (first: boolean) =>
    run(first ? "create" : "rotate", async () => {
      const t = await ent.rotateScimToken();
      setAsk(null);
      setSecret(t.token ?? null);
      await refreshAdmin(qc, "scim");
      return { tone: "ok", title: first ? tr("Token created") : tr("Token rotated"), detail: first ? tr("Paste it into your identity provider with the base URL.") : tr("The previous token stopped working. Paste the new one into your identity provider.") };
    });
  return (
    <section className="m2-adm-blk" aria-labelledby="m2-scim-h" data-testid="scim-card">
      <h2 id="m2-scim-h">{tr("Provisioning (SCIM)")}</h2>
      <p className="m2-adm-hint">{tr("Microsoft Entra ID, Okta and other identity providers create, update and suspend people here through SCIM 2.0. Give them the base URL and a token.")}</p>
      <Loaded q={q} what={tr("The SCIM token")} rows={2}>
        {(t) => (
          <>
            <Kv
              rows={[
                [tr("Token"), <StatusWord key="s" tone={t.configured ? "go" : "neutral"}>{t.configured ? tr("Active") : tr("No token")}</StatusWord>],
                [tr("Token prefix"), t.token_prefix ? <Mono key="p">{t.token_prefix}</Mono> : "—"],
                [tr("Created"), t.created_at ? formatDate(t.created_at, "datetime") : "—"],
                [tr("Last used"), t.last_used_at ? since(t.last_used_at) : "—"],
                [
                  tr("SCIM base URL"),
                  <span key="u" style={{ display: "inline-flex", gap: "var(--m2-s2)", alignItems: "center", flexWrap: "wrap" }}>
                    <Mono>{t.base_url}</Mono>
                    <button type="button" className="m2-btn m2-sm" onClick={() => void copyText(t.base_url).then(setCopied)}>
                      {copied ? tr("Copied") : tr("Copy the URL")}
                    </button>
                  </span>,
                ],
              ]}
            />
            {secret ? <OneTimeSecret token={secret} onDone={() => setSecret(null)} /> : null}
            {outcome ? <ResultFrame outcome={outcome} /> : null}
            <div className="m2-adm-acts">
              {t.configured ? (
                <>
                  <button type="button" className="m2-btn" disabled={pending !== null} onClick={() => setAsk("rotate")}>
                    {tr("Rotate the token")}
                  </button>
                  <button type="button" className="m2-btn m2-crit" disabled={pending !== null} onClick={() => setAsk("revoke")}>
                    {tr("Revoke")}
                  </button>
                </>
              ) : (
                <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={() => void rotate(true)}>
                  {pending === "create" ? tr("Creating…") : tr("Create a token")}
                </button>
              )}
            </div>
            {ask === "rotate" ? (
              <Confirm title={tr("Rotate the SCIM token")} body={tr("The current token stops working at once. Until the new one is in your identity provider, nobody is provisioned or suspended.")} confirm={tr("Rotate")} pending={pending === "rotate"} onCancel={() => setAsk(null)} onConfirm={() => void rotate(false)} />
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
        )}
      </Loaded>
      <GroupRoles />
    </section>
  );
}

/** Which identity-provider group gives which role. */
function GroupRoles() {
  const q = useScimGroupRoles();
  return (
    <div style={{ marginTop: "var(--m2-s4)" }}>
      <h3 className="m2-h2" style={{ fontSize: 13 }}>{tr("Group to role")}</h3>
      <p className="m2-adm-hint">{tr("A person in one of these identity provider groups gets its role. Saving re-syncs everyone in a SCIM group at once.")}</p>
      <Loaded q={q} what={tr("The group mapping")} rows={3}>
        {(m) => <GroupRoleEditor key={JSON.stringify(m.mappings)} initial={m} />}
      </Loaded>
    </div>
  );
}

export function GroupRoleEditor({ initial }: { initial: ScimMappings }) {
  const qc = useQueryClient();
  const roles = useRoles().data ?? [];
  const { outcome, pending, run } = useOutcome("scim-groups");
  const [rows, setRows] = useState(initial.mappings.map((r, i) => ({ group: r.group, role: r.role, id: i })));
  const [seq, setSeq] = useState(initial.mappings.length);
  const known = new Map(initial.mappings.map((m) => [m.group.trim().toLowerCase(), m]));
  const key = (g: string) => g.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
  const names = rows.map((r) => key(r.group));
  const dupes = new Set(names.filter((n, i) => n && names.indexOf(n) !== i));
  const empty = rows.some((r) => !r.group.trim());
  const ok = !empty && dupes.size === 0;
  const roleOptions = roles.length ? roles.map((r) => ({ key: r.key, name: r.name })) : initial.mappings.map((m) => ({ key: m.role, name: m.role_name }));
  return (
    <>
      <div className="m2-frame" tabIndex={0} role="region" aria-label={tr("Group to role mapping")} style={{ maxWidth: 760 }}>
        <table className="m2-tbl m2-maptbl">
          <thead>
            <tr>
              <th scope="col">{tr("Identity provider group")}</th>
              <th scope="col">{tr("Role in Meridian")}</th>
              <th scope="col" className="m2-r">{tr("Members")}</th>
              <th scope="col">
                <span className="m2-sr">{tr("Remove")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const saved = known.get(key(r.group));
              return (
                <tr key={r.id}>
                  <td>
                    <input type="text" aria-label={tr("Group {count}", { count: i + 1 })} aria-invalid={!r.group.trim() || dupes.has(key(r.group))} value={r.group} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, group: e.target.value } : x)))} />
                  </td>
                  <td>
                    <select aria-label={tr("Role for group {count}", { count: i + 1 })} value={r.role} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, role: e.target.value } : x)))}>
                      {roleOptions.some((o) => o.key === r.role) ? null : <option value={r.role}>{saved?.role_name ?? r.role}</option>}
                      {roleOptions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="m2-r">{saved ? (saved.group_exists ? saved.members : <span className="m2-meta">{tr("Not sent yet")}</span>) : "—"}</td>
                  <td>
                    <button type="button" className="m2-btn m2-sm m2-ghost" aria-label={tr("Remove group {count}", { count: i + 1 })} onClick={() => setRows(rows.filter((x) => x.id !== r.id))}>
                      {tr("Remove")}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4}>{tr("No group is mapped. Everyone provisioned keeps the role given here.")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="m2-prov">{tr("Members counts the people the identity provider has put in the group. Not sent yet: the provider has not sent a group of that name.")}</p>
      {empty ? <p className="m2-prov" role="alert">{tr("Every row needs a group name.")}</p> : null}
      {dupes.size ? <p className="m2-prov" role="alert">{tr("A group can map to one role only.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button type="button" className="m2-btn" disabled={roleOptions.length === 0} onClick={() => (setRows([...rows, { id: seq, group: "", role: roleOptions[roleOptions.length - 1]?.key ?? "" }]), setSeq(seq + 1))}>
          {tr("Add a group")}
        </button>
        <button
          type="button"
          className="m2-btn m2-strong"
          disabled={!ok || pending !== null}
          onClick={() =>
            void run("save", async () => {
              const saved = await ent.putScimGroupRoles(rows.map(({ group, role }) => ({ group: group.trim(), role })));
              await refreshAdmin(qc, "scim");
              return { tone: "ok", title: tr("Mapping saved"), detail: saved.resynced_users == null ? undefined : tr("{n, plural, one {# person was} other {# people were}} re-synced to the new roles.", { n: saved.resynced_users }) };
            })
          }
        >
          {pending === "save" ? tr("Saving…") : tr("Save the mapping")}
        </button>
      </div>
    </>
  );
}
