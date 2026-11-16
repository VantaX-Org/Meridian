"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mono } from "@/design/v2/parts";
import * as ent from "@/lib/api/v2/enterprise";
import type { ComplianceStatement, RetentionInput, ThemeSettings } from "@/lib/api/v2/enterprise";
import { formatDate } from "@/lib/format";
import { refreshAdmin } from "@/lib/v2/admin-queries";
import { useCompliance, useThemeSettings } from "@/lib/v2/enterprise-queries";
import { fixed } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { checkAccent, darkAccentFor, isHex, MIN_CONTRAST, refreshTenantTheme } from "@/lib/v2/theme";
import { Button } from "../kit";
import { Block, Field, Kv, Loaded, Note, OutcomeNote, Status, Switch, since, useCan, useOutcome, useUnsaved } from "./tenant-kit";

/* Appearance (GET/PUT /settings/theme, POST /settings/theme/logo) */

const ratioText = (r: number | null | undefined): string => (r == null ? "—" : `${fixed(r, 2)}:1`);
/** The server's product name limit (api/services/theme.py PRODUCT_NAME_MAX). */
const NAME_MAX = 40;

/** The contrast of the chosen accents, before saving: the server checks the same pairs again and has the last word. */
export function ContrastResult({ accent, accentDark, onUse }: { accent: string; accentDark: string; onUse?: (hex: string) => void }) {
  const c = checkAccent(accent);
  if (!c)
    return (
      <p className="nx-sub" role="alert">
        {t("Write the accent as # and six hexadecimal digits, for example the colour picker gives.")}
      </p>
    );
  const dark = accentDark.trim() ? (isHex(accentDark) ? accentDark.trim().toUpperCase() : null) : null;
  const passes = c.light >= MIN_CONTRAST;
  return (
    <div data-testid="contrast-result" className="nx-tn-embedded">
      <Kv
        rows={[
          [t("Accent on the light ground"), <Status key="l" tone={passes ? "go" : "no-go"}>{`${ratioText(c.light)}, ${passes ? t("passes") : t("below 4.5:1")}`}</Status>],
          [t("Dark-mode accent"), dark ? <Mono key="d">{dark}</Mono> : accentDark.trim() ? t("Not a hex colour") : t("Derived by the server from the accent")],
          ...(dark
            ? ([
                [
                  t("On the dark ground, as used"),
                  <span key="g" className="nx-tn-inline">
                    <span className="nx-tn-swatch" style={{ background: darkAccentFor(dark) } as CSSProperties} aria-hidden="true" />
                    <Mono>{darkAccentFor(dark)}</Mono>
                  </span>,
                ],
              ] as [string, ReactNode][])
            : []),
        ]}
      />
      {passes ? null : (
        <>
          <p className="nx-sub" role="alert">
            {t("Below 4.5:1 on the light ground: links and the primary button would be hard to read. Choose a darker accent.")}
          </p>
          <p className="nx-sub nx-tn-inline" data-testid="nearest-shade">
            <span className="nx-tn-swatch" style={{ background: c.lightShade } as CSSProperties} aria-hidden="true" />
            {t("The nearest shade of it that passes is {hex}.", { hex: c.lightShade })}
            {onUse ? (
              <Button size={32} onClick={() => onUse(c.lightShade)}>
                {t("Use this shade")}
              </Button>
            ) : null}
          </p>
        </>
      )}
    </div>
  );
}

/** What the server says it stored: the two accents and their contrast, a dash for what it does not have. */
function SavedTheme({ th }: { th: ThemeSettings }) {
  const rows: [string, ReactNode][] = [];
  if (th.product_name_override) rows.push([t("Product name"), th.product_name_override]);
  if (th.accent) rows.push([t("Accent"), <Mono key="a">{`${th.accent}, ${ratioText(th.contrast.on_white)} ${t("on white")}`}</Mono>]);
  if (th.accent_dark) rows.push([t("Dark-mode accent"), <Mono key="d">{`${th.accent_dark}, ${ratioText(th.contrast.on_dark)} ${t("on the dark ground")}`}</Mono>]);
  if (th.logo_url) rows.push([t("Logo"), th.logo_content_type ?? "—"]);
  if (rows.length === 0)
    return (
      <p className="nx-sub" data-testid="appearance-saved">
        {t("This tenant uses Meridian's own look; nothing has been customised.")}
      </p>
    );
  if (th.updated_at) rows.push([t("Last changed"), formatDate(th.updated_at, "datetime")]);
  return <Kv rows={rows} />;
}

/** The data hue the screen uses now as the starting accent; empty where styles are not computed (tests). */
function currentDataHue(): string {
  if (typeof document === "undefined") return "";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--nx-data").trim().toLowerCase();
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
  useUnsaved([file?.name ?? null, removeLogo, name, useAccent, accent, accentDark]);
  const [picker, setPicker] = useState(() => (initial.accent && isHex(initial.accent) ? initial.accent.toLowerCase() : currentDataHue()));
  const [logoError, setLogoError] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (filePreview && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(filePreview);
    },
    [filePreview],
  );
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
      setLogoError(t("Choose a PNG or SVG image."));
      return;
    }
    if (f.size > ent.LOGO_MAX_BYTES) {
      setLogoError(t("The logo is {ceil} KB; the limit is {max} KB.", { ceil: Math.ceil(f.size / 1024), max: ent.LOGO_MAX_BYTES / 1024 }));
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
      return { tone: "ok", title: reset ? t("Meridian's own look restored") : t("Appearance saved"), detail: t("Everyone sees it on their next page; the sign-in page shows the logo and name.") };
    });
  const previewDark = check && check.light >= MIN_CONTRAST ? (accentDark.trim() && isHex(accentDark) ? darkAccentFor(accentDark.trim()) : check.darkTint) : null;
  // The chosen accent, scoped to the preview only: the kit's primary button and the link read --nx-accent.
  const previewStyle = previewDark ? ({ "--nx-accent": accent.trim() } as CSSProperties) : undefined;
  return (
    <>
      <SavedTheme th={initial} />
      <div className="nx-tn-split">
        <div className="nx-tn-embedded">
          <div className="nx-tn-form">
            <Field label={t("Logo")} hint={t("PNG or SVG, {max} KB at most. It replaces the mark in the top bar and on the sign-in page.", { max: ent.LOGO_MAX_BYTES / 1024 })} error={logoError}>
              <input className="nx-input" type="file" accept={ent.LOGO_TYPES.join(",")} disabled={!write} onChange={(e) => onFile(e.target.files?.[0])} />
            </Field>
            <Field label={t("Product name")} hint={t("Shown beside the logo. Empty keeps Meridian.")} error={nameOk ? null : t("{max} characters at most, without < or >", { max: NAME_MAX })}>
              <input className="nx-input" type="text" value={name} maxLength={80} disabled={!write} onChange={(e) => setName(e.target.value)} placeholder={t("Meridian")} />
            </Field>
          </div>
          <Switch checked={useAccent} disabled={!write} label={t("Use our own accent colour")} onChange={setUseAccent} />
          {useAccent ? (
            <div className="nx-tn-form">
              <Field label={t("Accent")} hint={t("Links, the selected cell, the current run and the primary button. It must read at 4.5:1 on white.")}>
                <span className="nx-tn-inline">
                  <input
                    type="color"
                    aria-label={t("Accent, colour picker")}
                    value={picker}
                    disabled={!write}
                    onChange={(e) => {
                      setAccent(e.target.value);
                      setPicker(e.target.value);
                    }}
                  />
                  <input
                    className="nx-input nx-mono"
                    type="text"
                    aria-label={t("Accent, hexadecimal")}
                    value={accent}
                    disabled={!write}
                    spellCheck={false}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setAccent(v);
                      if (isHex(v)) setPicker(v.toLowerCase());
                    }}
                  />
                </span>
              </Field>
              <Field label={t("Dark-mode accent (optional)")} hint={t("Empty lets the server derive a lighter tint that reads at 4.5:1 on the dark ground.")} error={darkOk ? null : t("Write it as # and six hexadecimal digits")}>
                <input className="nx-input nx-mono" type="text" value={accentDark} disabled={!write} spellCheck={false} onChange={(e) => setAccentDark(e.target.value.trim())} />
              </Field>
            </div>
          ) : null}
          {useAccent ? (
            <ContrastResult
              accent={accent}
              accentDark={accentDark}
              onUse={
                write
                  ? (hex) => {
                      setAccent(hex);
                      setPicker(hex.toLowerCase());
                    }
                  : undefined
              }
            />
          ) : null}
          <OutcomeNote outcome={outcome} />
          {write ? (
            <div className="nx-tn-actions">
              <Button variant="primary" disabled={pending !== null || !nameOk || !accentOk} loading={pending === "save"} loadingLabel={t("Saving…")} onClick={() => save("save", false)}>
                {t("Save the appearance")}
              </Button>
              {shownLogo ? (
                <Button
                  variant="quiet"
                  onClick={() => {
                    setFile(null);
                    setFilePreview(null);
                    setRemoveLogo(true);
                  }}
                >
                  {t("Remove the logo")}
                </Button>
              ) : null}
              <Button
                variant="quiet"
                disabled={pending !== null}
                onClick={() => {
                  setFile(null);
                  setFilePreview(null);
                  setName("");
                  setUseAccent(false);
                  save("reset", true);
                }}
              >
                {t("Use Meridian's own look")}
              </Button>
            </div>
          ) : null}
        </div>
        <aside aria-label={t("Preview")} className="nx-tn-embedded">
          <h3 className="nx-tn-h3">{t("Preview")}</h3>
          <div className="nx-tn-preview" style={previewStyle} data-testid="appearance-preview">
            <div className="nx-tn-preview-bar">
              {/* eslint-disable-next-line @next/next/no-img-element -- the stored logo or the chosen file, before it is uploaded */}
              {shownLogo ? <img src={shownLogo} alt={t("Logo preview")} /> : null}
              <strong>{cleanName || t("Meridian")}</strong>
            </div>
            <div className="nx-tn-preview-bar" aria-hidden="true">
              <Button variant="primary" size={32} tabIndex={-1}>
                {t("Next step")}
              </Button>
              <span className="nx-tn-preview-link">{t("A link")}</span>
            </div>
          </div>
          <p className="nx-sub">{t("How the top bar reads with these settings, in the light theme.")}</p>
        </aside>
      </div>
    </>
  );
}

/** Admin, Settings, Appearance: the tenant's logo, product name and accents, with the contrast checked before saving. */
export function AppearanceBlock() {
  const write = useCan()("manage_settings");
  const q = useThemeSettings();
  return (
    <Block id="appearance" title={t("Appearance")} hint={t("Your logo, product name and accent, applied for everyone in this tenant and on the sign-in page. The Meridian mark stays under About in the account menu.")}>
      <Loaded q={q} what={t("The appearance")} rows={3}>
        {(th) => <AppearanceForm key={JSON.stringify(th)} initial={th} write={write} />}
      </Loaded>
    </Block>
  );
}

/* Compliance (GET/PUT /settings/compliance) */

/** The families the server names, in the interface's language; an unknown one keeps the server's English label. */
const FAMILY: Record<string, string> = {
  get analysis_versions() {
    return t("Analysis runs, findings and work lists");
  },
  get reports() {
    return t("Generated reports");
  },
  get audit_log() {
    return t("Audit log");
  },
  get health_samples() {
    return t("Health samples");
  },
  get jobs() {
    return t("Job progress");
  },
};
const yesNo = (v: boolean | null | undefined): string => (v == null ? "—" : v ? t("Yes") : t("No"));
const daysText = (d: number | null): string => (d == null ? t("Kept for ever") : t("{d, plural, one {# day} other {# days}}", { d }));

function ComplianceForm({ data, write }: { data: ComplianceStatement; write: boolean }) {
  const qc = useQueryClient();
  const { outcome, pending, run } = useOutcome("compliance");
  const editable = data.retention.families.filter((f) => f.configurable && ent.RETENTION_FIELD[f.family]);
  const [days, setDays] = useState<Record<string, string>>(() => Object.fromEntries(editable.map((f) => [f.family, f.days == null ? "" : String(f.days)])));
  useUnsaved(days);
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
          [t("Deployment"), res.deployment === "customer_hosted" ? t("Hosted by you: SAP data, findings and reports stay in your environment") : labelText(res.deployment)],
          [t("Database host"), res.database_host ? <Mono key="db">{res.database_host}</Mono> : "—"],
          [t("Object storage host"), res.object_storage_host ? <Mono key="os">{res.object_storage_host}</Mono> : "—"],
          [t("Language model"), res.llm_provider ? `${res.llm_provider}${res.llm_in_deployment == null ? "" : res.llm_in_deployment ? t(", inside this deployment") : t(", outside this deployment")}` : "—"],
          [t("Database volume encrypted at rest"), yesNo(enc.database_volume)],
          [t("Object storage encrypted at rest"), yesNo(enc.object_storage)],
          [t("SAP credentials encrypted"), yesNo(enc.sap_credentials)],
          [t("Language model API keys encrypted"), yesNo(enc.llm_api_keys)],
          [t("Last backup"), data.backup ? `${formatDate(data.backup.at, "datetime")} (${since(data.backup.at)})` : "—"],
          [
            t("Deletion"),
            enf.enforced ? t("Enforced every night") : !enf.flag_enabled ? t("Off: purging is not enabled on this deployment") : enf.dry_run_until ? t("Dry run until {date}, then enforced", { date: formatDate(enf.dry_run_until, "date") }) : t("Dry run, starting tonight"),
          ],
        ]}
      />
      {enc.database_volume === false || enc.object_storage === false ? <Note tone="warn">{t("Part of the storage is not encrypted at rest. Turn it on in the database and storage configuration of this deployment.")}</Note> : null}
      <p className="nx-sub">{t("A dash means this deployment does not declare it.")}</p>
      <div className="nx-tn-table-wrap" tabIndex={0} role="region" aria-label={t("Retention by kind of data")}>
        <table className="nx-table">
          <thead>
            <tr>
              <th scope="col">{t("Kind of data")}</th>
              <th scope="col">{t("Kept for")}</th>
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
                      <input
                        className="nx-input"
                        type="number"
                        min={ent.RETENTION_MIN[field(f.family)]}
                        max={ent.RETENTION_MAX}
                        step={1}
                        placeholder={t("For ever")}
                        aria-label={t("{familyLabel}, days kept", { familyLabel: label })}
                        aria-invalid={!valid(f.family, days[f.family] ?? "")}
                        value={days[f.family] ?? ""}
                        onChange={(e) => setDays({ ...days, [f.family]: e.target.value })}
                      />
                    ) : (
                      <>
                        {daysText(f.days)}
                        {f.configurable ? null : <span className="nx-sub">{` ${t("(fixed)")}`}</span>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="nx-sub">
        {t("The baseline run is {kept}; the newest {n, plural, one {run} other {# runs}} of each system {n, plural, one {is} other {are}} always kept.", { kept: data.retention.keep_baseline ? t("kept") : t("not kept"), n: data.retention.keep_latest_per_system })}
      </p>
      {!ok ? (
        <p className="nx-sub" role="alert">
          {t("Runs and reports are kept from 1 to 3650 days, the audit log from 30; empty keeps them for ever.")}
        </p>
      ) : null}
      <OutcomeNote outcome={outcome} />
      {write ? (
        <div className="nx-tn-actions">
          <Button
            variant="primary"
            disabled={!ok || !changed || pending !== null}
            loading={pending === "save"}
            loadingLabel={t("Saving…")}
            onClick={() =>
              void run("save", async () => {
                const body: RetentionInput = {};
                for (const f of editable) {
                  const v = (days[f.family] ?? "").trim();
                  body[field(f.family)] = v ? Number(v) : null;
                }
                await ent.putCompliance(body);
                await refreshAdmin(qc, "compliance");
                return { tone: "ok", title: t("Retention saved"), detail: t("The nightly task applies it, first as a dry run.") };
              })
            }
          >
            {t("Save retention")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** Admin, Settings, Compliance: where the data lives, what is encrypted, the last backup, and how long each kind is kept. */
export function ComplianceBlock() {
  const can = useCan();
  const q = useCompliance();
  return (
    <Block id="compliance" title={t("Compliance")} hint={t("Where this deployment keeps its data, what is encrypted at rest, the last backup, and how long each kind of data is kept.")}>
      <Loaded q={q} what={t("The compliance statement")} rows={3}>
        {(c) => <ComplianceForm key={JSON.stringify(c.retention)} data={c} write={can("manage_settings")} />}
      </Loaded>
    </Block>
  );
}
