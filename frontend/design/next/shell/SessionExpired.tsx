"use client";

import { useEffect, useState } from "react";
import { onSessionExpired } from "@/lib/api/client";
import { t } from "@/lib/v2/i18n";
import { Confirm, hasUnsavedSheet } from "../kit";

/**
 * An expired session while a sheet holds unsaved edits: keep the page (and the draft) and offer sign-in in a new
 * tab. The session cookie is shared, so once signed in there, Save works here. With nothing unsaved, the client
 * sends the page to sign-in as before.
 */
export function SessionExpired() {
  const [open, setOpen] = useState(false);
  useEffect(
    () =>
      onSessionExpired(() => {
        if (!hasUnsavedSheet()) return false;
        setOpen(true);
        return true;
      }),
    [],
  );
  return (
    <Confirm
      open={open}
      title={t("Your session has ended.")}
      consequence={t("Sign in again in a new tab, then come back and save. Your edits here are kept.")}
      confirmLabel={t("Sign in again")}
      onConfirm={() => {
        const back = window.location.pathname + window.location.search;
        window.open(`/sign-in?next=${encodeURIComponent(back)}`, "_blank", "noopener");
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}
