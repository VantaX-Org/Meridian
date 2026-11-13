"use client";

/** Invite a user: who, role, send, link. Wraps inviteUser and createInviteLink only; the users routes are not touched. */
import { useState } from "react";
import { StepFlow, type FlowStep } from "@/design/next/kit";
import { createInviteLink, inviteUser } from "@/lib/api/users";
import { t } from "@/lib/v2/i18n";

export interface InviteApi {
  invite: (b: { email: string; name?: string; grants: { role_key: string }[] }) => Promise<{ id: string }>;
  link: (id: string) => Promise<unknown>;
}
const LIVE: InviteApi = { invite: inviteUser, link: createInviteLink as InviteApi["link"] };

export function InviteFlow({ roles, api = LIVE, onDone }: { roles: { key: string; label: string }[]; api?: InviteApi; onDone?: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(roles[0]?.key ?? "");
  const [id, setId] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const ok = /^\S+@\S+\.\S+$/.test(email);
  const steps: FlowStep[] = [
    { id: "who", label: t("Who"), blocked: ok ? undefined : t("Enter a valid email address."),
      body: <><label className="nx-field">{t("Email")}<input className="nx-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="nx-field">{t("Name")}<input className="nx-input" value={name} onChange={(e) => setName(e.target.value)} /></label></> },
    { id: "role", label: t("Role"), blocked: role ? undefined : t("Choose a role."),
      next: { label: t("Send invite"), run: async () => setId((await api.invite({ email, name: name || undefined, grants: [{ role_key: role }] })).id) },
      body: <div role="radiogroup" aria-label={t("Role")}>{roles.map((r) => <label key={r.key} className="nx-field"><span><input type="radio" name="role" checked={role === r.key} onChange={() => setRole(r.key)} /> {r.label}</span></label>)}</div> },
    { id: "link", label: t("Invite link"), next: { label: t("Create link"), run: async () => { if (id) setLink(String(await api.link(id))); } },
      body: <p data-testid="invite-link">{link ?? t("The invite is sent. Create a link to share it another way.")}</p> },
  ];
  return <StepFlow steps={steps} label={t("Invite a user")} onFinish={onDone} />;
}
