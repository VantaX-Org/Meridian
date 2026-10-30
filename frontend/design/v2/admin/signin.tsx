"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SsoConfig, SsoConfigInput } from "@/lib/api/sso";
import * as api from "@/lib/api/v2/admin";
import { refreshAdmin, useSso } from "@/lib/v2/admin-queries";
import { V2Link } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Confirm, Fld, Loaded, NeedsPermission, Note, Sw, copyText, useCan } from "./kit";
import { t } from "@/lib/v2/i18n";

/** "corp.com, Example.org" to ["corp.com", "example.org"]; the server validates each one. */
export function parseDomains(raw: string): string[] {
  return raw.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

function SsoForm({ saved, part }: { saved: SsoConfig; part: "sso" | "signin" }) {
  const qc = useQueryClient();
  const [issuer, setIssuer] = useState(saved.issuer);
  const [clientId, setClientId] = useState(saved.client_id);
  const [secret, setSecret] = useState("");
  const [displayName, setDisplayName] = useState(saved.display_name);
  const [domains, setDomains] = useState(saved.allowed_domains.join(", "));
  const [enforce, setEnforce] = useState(saved.enforce);
  const [confirm, setConfirm] = useState<"enforce" | "remove" | null>(null);
  const [touched, setTouched] = useState(false);
  const { outcome, pending, run } = useOutcome("sso-form");
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

  const save = () =>
    void run("save", async () => {
      const c = await api.saveSso(input);
      await refreshAdmin(qc, "sso");
      setSecret("");
      setConfirm(null);
      return { tone: "ok", title: t("Sign-in settings saved"), detail: c.enforce ? t("Single sign-on is required for everyone but administrators.") : undefined };
    });
  const test = () =>
    void run("test", async () => {
      const r = await api.testSso(issuer.trim() || undefined);
      return { tone: r.ok ? "ok" : "fail", title: r.ok ? t("The identity provider answered") : t("The identity provider did not answer"), detail: r.message };
    });
  const remove = () =>
    void run("remove", async () => {
      await api.removeSso();
      await refreshAdmin(qc, "sso");
      setConfirm(null);
      return { tone: "ok", title: t("Single sign-on turned off"), detail: t("People who signed in through the provider keep their accounts and use a password; those who never set one use Forgot password.") };
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
          <div className="m2-fgrid">
            <Fld label={t("Issuer address")} error={show("issuer")} wide>
              <input type="url" inputMode="url" placeholder="https://login.example.com/tenant-id/v2.0" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
            </Fld>
            <Fld label={t("Client ID")} error={show("clientId")}>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
            </Fld>
            <Fld label={t("Client secret")} error={show("secret")} hint={t("Stored encrypted and never shown again.")}>
              <input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={saved.has_secret ? t("Stored. Leave blank to keep it") : ""} />
            </Fld>
            <Fld label={t("Button name")} error={show("displayName")} hint={t("Shown as “Sign in with …”; who may use it is under Sign-in page.")}>
              <input value={displayName} maxLength={60} placeholder={t("Company login")} onChange={(e) => setDisplayName(e.target.value)} />
            </Fld>
          </div>
          {saved.redirect_uri ? (
            <p className="m2-prov" style={{ marginTop: 12 }}>
              {t("Register this redirect address at your identity provider: ")}
              <span className="m2-mono">{saved.redirect_uri}</span>{" "}
              <button type="button" className="m2-linkbtn" onClick={() => void copyText(saved.redirect_uri)}>
                {t("Copy")}
              </button>
            </p>
          ) : null}
        </Block>
      ) : (
        <Block title={t("Sign in with your identity provider")} hint={t("How the button reads on the sign-in page, who may use it, and whether passwords still work.")}>
          {!configured ? (
            <Note tone="warn">
              {t("Single sign-on is not set up yet, so there is nothing to show on the sign-in page. Set it up under ")}
              <V2Link href="/admin/sso">{t("Single sign-on")}</V2Link>
              {" first."}
            </Note>
          ) : null}
          <div className="m2-fgrid">
            <Fld label={t("Button name")} error={show("displayName")} hint={t("Shown as “Sign in with …”.")}>
              <input value={displayName} maxLength={60} placeholder={t("Company login")} onChange={(e) => setDisplayName(e.target.value)} disabled={!configured} />
            </Fld>
            <Fld label={t("Allowed email domains")} hint={t("Only these domains can sign in and link to an existing account by email. Empty means nobody can.")}>
              <input value={domains} placeholder={t("example.com, example.org")} onChange={(e) => setDomains(e.target.value)} disabled={!configured} />
            </Fld>
            <div className="m2-wide">
              <Sw checked={enforce} onChange={setEnforce} disabled={!configured} label={t("Require single sign-on")} hint={t("Password sign-in stops for everyone except administrators, who keep it as a way in if the provider is down.")} />
            </div>
          </div>
        </Block>
      )}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button type="button" className="m2-btn m2-next" disabled={pending !== null || (part === "signin" && !configured)} onClick={onSave}>
          {pending === "save" ? t("Saving…") : t("Save sign-in settings")}
        </button>
        {part === "sso" ? (
          <button type="button" className="m2-btn" disabled={pending !== null || !issuer.trim()} onClick={test}>
            {pending === "test" ? t("Testing…") : t("Test sign-in")}
          </button>
        ) : null}
        {part === "sso" && configured ? (
          <button type="button" className="m2-btn m2-crit" disabled={pending !== null} onClick={() => setConfirm("remove")}>
            {t("Turn off single sign-on")}
          </button>
        ) : null}
      </div>
      {invalid && touched ? <p className="m2-prov">{t("Save is waiting for the fields marked above.")}</p> : null}
      {part === "signin" ? (
        <Block title={t("Password sign-in")} hint={t("These rules are fixed and apply to every password account. They are not settings.")}>
          <dl className="m2-kv">
            <dt>{t("Password rules")}</dt>
            <dd>{t("At least 12 characters, not the email name, and not a common password")}</dd>
            <dt>{t("Lockout")}</dt>
            <dd>{t("10 failed sign-ins lock the account for 15 minutes")}</dd>
          </dl>
        </Block>
      ) : null}
      {confirm === "enforce" ? (
        <Confirm
          title={t("Require single sign-on")}
          body={t("Password sign-in will stop for everyone except administrators. People who cannot sign in through the identity provider will be locked out until an administrator changes this.")}
          confirm={t("Require single sign-on")}
          cancel={t("Keep password sign-in")}
          danger
          pending={pending === "save"}
          onCancel={() => setConfirm(null)}
          onConfirm={save}
        />
      ) : null}
      {confirm === "remove" ? (
        <Confirm
          title={t("Turn off single sign-on")}
          body={t("The settings are removed. People who signed in through the identity provider keep their accounts and sign in with a password; those who never set one use Forgot password.")}
          confirm={t("Turn off single sign-on")}
          cancel={t("Keep single sign-on")}
          danger
          pending={pending === "remove"}
          onCancel={() => setConfirm(null)}
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}

export function SsoSection({ part }: { part: "sso" | "signin" }) {
  const can = useCan();
  const allowed = can("manage_users");
  const q = useSso(allowed);
  const title = part === "sso" ? t("Single sign-on") : t("Sign-in page");
  if (!allowed) return <AdminPage title={title}><NeedsPermission what={t("Changing sign-in")} permission="manage_users" /></AdminPage>;
  return (
    <AdminPage title={title} lead={part === "sso" ? t("Connect Meridian to your identity provider with OpenID Connect.") : t("What people see when they sign in, and who may use single sign-on.")}>
      <Loaded q={q} what={t("The sign-in settings")} rows={4}>
        {(saved) => <SsoForm key={`${saved.issuer}|${saved.client_id}|${saved.display_name}|${saved.enforce}|${saved.configured}|${saved.allowed_domains.join(",")}`} saved={saved} part={part} />}
      </Loaded>
    </AdminPage>
  );
}
