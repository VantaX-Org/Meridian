"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createAccessRequest } from "@/lib/api/me";
import { errorSentence } from "@/lib/api/v2/client";
import { usePermissions } from "@/lib/permissions";
import { accessLabel, type RequestTarget } from "@/lib/rbac";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Dialog } from "./admin/kit";
import { ResultFrame } from "./inspector/shared";

/** Draws the dialog for whatever request the permissions provider holds (lib/permissions.tsx). Mounted once by the shell. */
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
    <Dialog title={t("Request access")} onClose={onClose}>
      {/* Keyed so each new target starts with an empty reason and no stale answer. */}
      <RequestForm key={`${target.resource}/${target.action}/${target.system_id ?? ""}/${target.module ?? ""}`} target={target} onClose={onClose} />
    </Dialog>
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
      className="m2-aform"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <dl className="m2-facts">
        <dt>{t("Access")}</dt>
        <dd>{accessLabel(target.resource, target.action)}</dd>
        <dt>{t("Scope")}</dt>
        <dd>{scope}</dd>
      </dl>
      <label>
        {t("Reason (optional)")}
        <textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {send.isError ? <ResultFrame outcome={{ tone: "fail", title: t("The request was not sent"), detail: errorSentence(send.error, t("Try again in a minute.")) }} /> : null}
      {send.isSuccess ? <ResultFrame outcome={{ tone: "ok", title: t("Request sent to the administrators"), detail: t("You hear in your inbox when it is granted or declined.") }} /> : null}
      <div className="m2-acts">
        {send.isSuccess ? (
          <button type="button" className="m2-btn m2-strong" onClick={onClose}>
            {t("Done")}
          </button>
        ) : (
          <>
            <button type="submit" className="m2-btn m2-strong" disabled={send.isPending}>
              {send.isPending ? t("Sending…") : t("Send request")}
            </button>
            <button type="button" className="m2-btn" onClick={onClose}>
              {t("Not now")}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
