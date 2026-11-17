"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createAccessRequest } from "@/lib/api/me";
import { errorSentence } from "@/lib/api/v2/client";
import { usePermissions } from "@/lib/permissions";
import { accessLabel, type RequestTarget } from "@/lib/rbac";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Field, Sheet, Textarea } from "@/ui/kit";
import { AuthNote } from "./AuthFrame";

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
    <Sheet open onClose={onClose} label={t("Request access")} closeLabel={t("Close")}>
      {/* Keyed so each new target starts with an empty reason and no stale answer. */}
      <RequestForm key={`${target.resource}/${target.action}/${target.system_id ?? ""}/${target.module ?? ""}`} target={target} onClose={onClose} />
    </Sheet>
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
      className="mx-auth-form"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <h2 className="mx-state-h">{t("Request access")}</h2>
      <dl className="mx-auth-facts">
        <dt>{t("Access")}</dt>
        <dd>{accessLabel(target.resource, target.action)}</dd>
        <dt>{t("Scope")}</dt>
        <dd>{scope}</dd>
      </dl>
      <Field label={t("Reason (optional)")}>
        <Textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {send.isError ? <AuthNote tone="danger" title={t("The request was not sent")}>{errorSentence(send.error, t("Try again in a minute."))}</AuthNote> : null}
      {send.isSuccess ? <AuthNote tone="info" title={t("Request sent to the administrators")}>{t("You hear in your inbox when it is granted or declined.")}</AuthNote> : null}
      <div className="mx-auth-row">
        {send.isSuccess ? (
          <button type="button" className="mx-btn" data-variant="primary" onClick={onClose}>{t("Done")}</button>
        ) : (
          <>
            <button type="submit" className="mx-btn" data-variant="primary" disabled={send.isPending}>
              {send.isPending ? t("Sending…") : t("Send request")}
            </button>
            <button type="button" className="mx-btn" data-variant="secondary" onClick={onClose}>{t("Not now")}</button>
          </>
        )}
      </div>
    </form>
  );
}
