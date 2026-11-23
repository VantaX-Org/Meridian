"use client";

import { useState } from "react";
import { LOGO_MAX_BYTES, LOGO_TYPES, putThemeSettings, uploadThemeLogo, type ThemeSettings } from "@/lib/api/v2/enterprise";
import { t } from "@/lib/v2/i18n";
import { Button, Confirm, Field, FileDrop, Input } from "@/ui/kit";
import { Row, useAct } from "./shared";

/** Edits the tenant's product name and accents (PUT /settings/theme), uploads a logo and removes it. The server checks contrast and says why it refuses. */
export function ThemeEditor({ theme }: { theme: ThemeSettings }) {
  const { run, busy } = useAct("theme");
  const [name, setName] = useState(theme.product_name_override ?? "");
  const [accent, setAccent] = useState(theme.accent ?? "");
  const [dark, setDark] = useState(theme.accent_dark ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [ask, setAsk] = useState(false);
  const tooBig = file != null && file.size > LOGO_MAX_BYTES;
  const badType = file != null && !(LOGO_TYPES as readonly string[]).includes(file.type);
  const nul = (v: string) => (v.trim() === "" ? null : v.trim());
  const save = () => run(() => putThemeSettings({ product_name_override: nul(name), accent: nul(accent), accent_dark: nul(dark), logo_url: theme.logo_url }), t("Branding saved"));
  const upload = async () => { if (file && (await run(() => uploadThemeLogo(file), t("Logo uploaded")))) setFile(null); };
  return (
    <>
      <Field label={t("Product name")} hint={t("Empty keeps the default name.")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Row>
        <Field label={t("Accent")} hint={theme.contrast.on_white != null ? t("Contrast on white {n}", { n: theme.contrast.on_white }) : t("Six hex digits after the hash sign.")}><Input value={accent} onChange={(e) => setAccent(e.target.value)} /></Field>
        <Field label={t("Dark mode accent")} hint={theme.contrast.on_dark != null ? t("Contrast on dark {n}", { n: theme.contrast.on_dark }) : undefined}><Input value={dark} onChange={(e) => setDark(e.target.value)} /></Field>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>{t("Save branding")}</Button>
      </Row>
      <FileDrop accept="image/png,image/svg+xml" label={t("Logo")} onFile={setFile}
        status={file ? (tooBig ? t("{name} is over 512 KB.", { name: file.name }) : badType ? t("{name} is not a PNG or SVG.", { name: file.name }) : file.name) : (theme.logo_url ? t("A logo is set.") : t("PNG or SVG, 512 KB at most."))} />
      <Row>
        <Button variant="secondary" disabled={busy || !file || tooBig || badType} onClick={() => void upload()}>{t("Upload logo")}</Button>
        {theme.logo_url ? <Button variant="ghost" disabled={busy} onClick={() => setAsk(true)}>{t("Remove logo")}</Button> : null}
      </Row>
      <Confirm open={ask} danger title={t("Remove the logo?")} confirmLabel={t("Remove logo")} cancelLabel={t("Cancel")} onCancel={() => setAsk(false)}
        onConfirm={() => { setAsk(false); void run(() => putThemeSettings({ product_name_override: nul(name), accent: nul(accent), accent_dark: nul(dark), logo_url: null }), t("Logo removed")); }}>
        <p>{t("Sign-in and the header go back to the Meridian mark.")}</p>
      </Confirm>
    </>
  );
}
