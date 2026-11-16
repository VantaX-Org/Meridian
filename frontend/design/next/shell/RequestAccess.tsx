"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createAccessRequest } from "@/lib/api/me";
import { errorSentence } from "@/lib/api/v2/client";
import { usePermissions } from "@/lib/permissions";
import { accessLabel, type RequestTarget } from "@/lib/rbac";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Button, Sheet } from "../kit";
import "./auth.css";

/** Draws the sheet for whatever request the permissions provider holds (lib/permissions.tsx). Mounted once by the shell. */
export function RequestAccessHost() {
  const { accessTarget, closeAccessRequest } = usePermissions();
  return <RequestAccessDialog target={accessTarget} onClose={closeAccessRequest} />;
}

/**
 * Request access: opened when an action is refused for a missing permission (lib/api/client.ts tells the permissions
 * provider). The access in plain words and its scope come filled in, a reason is optional, and the request goes to
 * POST /access-requests, where an administrator grants or declines it (Administration, Users).
 */
export function RequestAccessDialog({ target, onClose }: { target: RequestTarget | null; onClose: () => void }) {
  if (!target) return null;
  return (
    <Sheet open onClose={onClose} title={t("Request access")} size="small">
      {/* Keyed so each new target starts with an empty reason and no stale answer. */}
      <RequestForm key={`${target.resource}/${target.action}/${target.system_id ?? ""}/${target.module ?? ""}`} target={target} onClose={onClose} />
    </Sheet>
  );
}

function Outcome({ tone, title, detail }: { tone: "ok" | "fail"; title: string; detail: string }) {
  return (
    <div className="nx-ra-out" data-tone={tone} role={tone === "fail" ? "alert" : "status"}>
      <p className="nx-ra-out-title">{title}</p>
      <p className="nx-ra-out-detail">{detail}</p>
    </div>
  );
}

function RequestForm({ target, onClose }: { target: RequestTarget; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const send = useMutation({
    mutationFn: () => createAccessRequest({ resource: target.resource, action: target.action, system_id: target.system_id ?? null, module: target.module ?? null, reason: reason.trim() || undefined }),
  });
  // Never a raw id: the caller's system name, else "one system".
  const system = target.systemLabel ?? (target.system_id ? t("One system") : t("All systems"));
  const scope = t("{system}, {object}", { system, object: target.module ? labelText(target.module) : t("all objects") });
  return (
    <form
      className="nx-form"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <dl className="nx-ra-facts">
        <dt>{t("Access")}</dt>
        <dd>{accessLabel(target.resource, target.action)}</dd>
        <dt>{t("Scope")}</dt>
        <dd>{scope}</dd>
      </dl>
      <label className="nx-field">
        {t("Reason (optional)")}
        <textarea className="nx-input" rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {send.isError ? <Outcome tone="fail" title={t("The request was not sent")} detail={errorSentence(send.error, t("Try again in a minute."))} /> : null}
      {send.isSuccess ? <Outcome tone="ok" title={t("Request sent to the administrators")} detail={t("You hear in your inbox when it is granted or declined.")} /> : null}
      <div className="nx-auth-row">
        {send.isSuccess ? (
          <Button variant="primary" onClick={onClose}>{t("Done")}</Button>
        ) : (
          <>
            <Button type="submit" variant="primary" loading={send.isPending}>
              {send.isPending ? t("Sending…") : t("Send request")}
            </Button>
            <Button onClick={onClose}>{t("Not now")}</Button>
          </>
        )}
      </div>
    </form>
  );
}
