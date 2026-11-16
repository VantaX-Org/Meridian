"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import type { SsoConfig, SsoConfigInput } from "@/lib/api/sso";
import * as api from "@/lib/api/v2/admin";
import { apiErrorMessage } from "@/lib/error";
import { refreshAdmin, useSso } from "@/lib/v2/admin-queries";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, Code, Confirm, useToast } from "../kit";
import { Denied } from "../more/states";
import { Block, CopyButton, Field, Loaded, Notes, Page, Switch } from "./people-kit";

/** "corp.com, Example.org" to ["corp.com", "example.org"]; the server validates each one. */
function parseDomains(raw: string): string[] {
  return raw.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

function SsoForm({ saved, part }: { saved: SsoConfig; part: "sso" | "signin" }) {
  const qc = useQueryClient();
  const toast = useToast();
  const href = useV2Href();
  const [issuer, setIssuer] = useState(saved.issuer);
  const [clientId, setClientId] = useState(saved.client_id);
  const [secret, setSecret] = useState(""); // OIDC client secret: write-only, never shown, never logged
  const [displayName, setDisplayName] = useState(saved.display_name);
  const [domains, setDomains] = useState(saved.allowed_domains.join(", "));
  const [enforce, setEnforce] = useState(saved.enforce);
  const [confirm, setConfirm] = useState<"enforce" | "remove" | null>(null);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<"save" | "test" | "remove" | null>(null);
  const configured = saved.configured;

  const input: SsoConfigInput = {
    issuer: issuer.trim(),
    client_id: clientId.trim(),
    display_name: displayName.trim(),
    allowed_domains: parseDomains(domains),
    default_role: "viewer",
    enforce,
    ...(secret.trim() ? { client_secret: secret.trim() } : {}),
  };
  const needsSecret = !saved.has_secret || saved.issuer !== input.issuer || saved.client_id !== input.client_id;
  const errors = {
    issuer: issuer.trim() ? null : t("Enter the issuer address"),
    clientId: clientId.trim() ? null : t("Enter the client ID"),
    secret: needsSecret && !secret.trim() ? (saved.has_secret ? t("Enter the secret again when the issuer or client ID changes") : t("Enter the client secret")) : null,
    displayName: displayName.trim() ? null : t("Enter the name shown on the sign-in button"),
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  const run = async (which: "save" | "test" | "remove", job: () => Promise<{ ok: boolean; text: string }>) => {
    if (pending) return;
    setPending(which);
    try {
      const r = await job();
      toast({ text: r.text, tone: r.ok ? "good" : "bad" });
    } catch (e) {
      toast({ text: apiErrorMessage(e), tone: "bad" });
    } finally {
      setPending(null);
    }
  };
  const save = () =>
    void run("save", async () => {
      const c = await api.saveSso(input);
      await refreshAdmin(qc, "sso");
      setSecret("");
      setConfirm(null);
      return { ok: true, text: c.enforce ? `${t("Sign-in settings saved")}. ${t("Single sign-on is required for everyone but administrators.")}` : t("Sign-in settings saved") };
    });
  const test = () =>
    void run("test", async () => {
      const r = await api.testSso(issuer.trim() || undefined);
      const title = r.ok ? t("The identity provider answered") : t("The identity provider did not answer");
      return { ok: r.ok, text: r.message ? `${title}. ${r.message}` : title };
    });
  const remove = () =>
    void run("remove", async () => {
      await api.removeSso();
      await refreshAdmin(qc, "sso");
      setConfirm(null);
      return { ok: true, text: `${t("Single sign-on turned off")}. ${t("People who signed in through the provider keep their accounts and use a password; those who never set one use Forgot password.")}` };
    });
  const onSave = () => {
    setTouched(true);
    if (invalid) return;
    if (enforce && !saved.enforce) setConfirm("enforce");
    else save();
  };

  return (
    <>
      {part === "sso" ? (
        <Block title={t("OpenID Connect")} hint={t("Use your identity provider, such as Microsoft Entra ID or Okta. People who sign in for the first time get the Viewer role and no access grants; give them access under Users.")}>
          <div className="nx-ppl-form">
            <Field label={t("Issuer address")} error={show("issuer")} wide>
              <input type="url" inputMode="url" placeholder="https://login.example.com/tenant-id/v2.0" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
            </Field>
            <Field label={t("Client ID")} error={show("clientId")}>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
            </Field>
            <Field label={t("Client secret")} error={show("secret")} hint={t("Stored encrypted and never shown again.")}>
              <input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={saved.has_secret ? t("Stored. Leave blank to keep it") : ""} />
            </Field>
            <Field label={t("Button name")} error={show("displayName")} hint={t("Shown as “Sign in with …”; who may use it is under Sign-in page.")}>
              <input value={displayName} maxLength={60} placeholder={t("Company login")} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
          </div>
          {saved.redirect_uri ? (
            <p className="nx-sub nx-ppl-acts">
              {t("Register this redirect address at your identity provider: ")}
              <Code code={saved.redirect_uri} />
              <CopyButton text={saved.redirect_uri} label={t("Copy")} />
            </p>
          ) : null}
        </Block>
      ) : (
        <Block title={t("Sign in with your identity provider")} hint={t("How the button reads on the sign-in page, who may use it, and whether passwords still work.")}>
          {!configured ? (
            <p className="nx-ppl-bad" role="status">
              {t("Single sign-on is not set up yet, so there is nothing to show on the sign-in page. Set it up under ")}
              <Link className="nx-link" href={href("/more/admin/sso")}>{t("Single sign-on")}</Link>
              {t(" first.")}
            </p>
          ) : null}
          <div className="nx-ppl-form">
            <Field label={t("Button name")} error={show("displayName")} hint={t("Shown as “Sign in with …”.")}>
              <input value={displayName} maxLength={60} placeholder={t("Company login")} onChange={(e) => setDisplayName(e.target.value)} disabled={!configured} />
            </Field>
            <Field label={t("Allowed email domains")} hint={t("Only these domains can sign in and link to an existing account by email. Empty means nobody can.")}>
              <input value={domains} placeholder={t("example.com, example.org")} onChange={(e) => setDomains(e.target.value)} disabled={!configured} />
            </Field>
            <Switch checked={enforce} onChange={setEnforce} disabled={!configured} label={t("Require single sign-on")} hint={t("Password sign-in stops for everyone except administrators, who keep it as a way in if the provider is down.")} />
          </div>
        </Block>
      )}
      <div className="nx-ppl-acts">
        <Button variant="primary" loading={pending === "save"} loadingLabel={t("Saving…")} disabled={pending !== null || (part === "signin" && !configured)} onClick={onSave}>
          {t("Save sign-in settings")}
        </Button>
        {part === "sso" ? (
          <Button loading={pending === "test"} loadingLabel={t("Testing…")} disabled={pending !== null || !issuer.trim()} onClick={test}>
            {t("Test sign-in")}
          </Button>
        ) : null}
        {part === "sso" && configured ? (
          <Button variant="danger" disabled={pending !== null} onClick={() => setConfirm("remove")}>
            {t("Turn off single sign-on")}
          </Button>
        ) : null}
      </div>
      {invalid && touched ? <p className="nx-sub">{t("Save is waiting for the fields marked above.")}</p> : null}
      {part === "signin" ? (
        <Block title={t("Password sign-in")} hint={t("These rules are fixed and apply to every password account. They are not settings.")}>
          <Notes
            rows={[
              [t("Password rules"), t("At least 12 characters, not the email name, and not a common password")],
              [t("Lockout"), t("10 failed sign-ins lock the account for 15 minutes")],
            ]}
          />
        </Block>
      ) : null}
      <Confirm
        open={confirm === "enforce"}
        title={t("Require single sign-on")}
        consequence={t("Password sign-in will stop for everyone except administrators. People who cannot sign in through the identity provider will be locked out until an administrator changes this.")}
        confirmLabel={t("Require single sign-on")}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={save}
      />
      <Confirm
        open={confirm === "remove"}
        title={t("Turn off single sign-on")}
        consequence={t("The settings are removed. People who signed in through the identity provider keep their accounts and sign in with a password; those who never set one use Forgot password.")}
        confirmLabel={t("Turn off single sign-on")}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={remove}
      />
    </>
  );
}

/** Single sign-on (part "sso") and the sign-in page (part "signin"): one form over the same saved settings. */
export function SsoSection({ part }: { part: "sso" | "signin" }) {
  const { can } = useV2Session();
  const allowed = can("manage_users");
  const q = useSso(allowed);
  if (!allowed) return <Denied what={t("Changing sign-in")} />;
  return (
    <Page lead={part === "sso" ? t("Connect Meridian to your identity provider with OpenID Connect.") : t("What people see when they sign in, and who may use single sign-on.")}>
      <Loaded q={q} what={t("The sign-in settings")} rows={4}>
        {(saved) => <SsoForm key={`${saved.issuer}|${saved.client_id}|${saved.display_name}|${saved.enforce}|${saved.configured}|${saved.allowed_domains.join(",")}`} saved={saved} part={part} />}
      </Loaded>
    </Page>
  );
}
