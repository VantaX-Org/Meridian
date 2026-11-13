"use client";

import { useEffect, useState } from "react";
import { Inspector } from "@/design/v2/Inspector";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { LegacyScope } from "../shell/LegacyMount";
import { Icon } from "../Icon";
import { Sheet } from "./Sheet";

/** The phone width under which the inspector is a sheet rather than a column. */
export const PHONE = "(max-width: 760px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia?.(PHONE);
    if (!m) return;
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return phone;
}

/**
 * The right-hand column. It shows whatever `?open=` names, with the v2 inspector as its content. Solid, a hairline on
 * its left edge; between 1024 and 1279 px it overlays the page over a scrim; on a phone it is a bottom sheet.
 */
export function InspectorColumn() {
  const { open, close } = useOpenItem();
  const phone = usePhone();
  if (!open) return null;
  const body = <LegacyScope><Inspector /></LegacyScope>;
  if (phone) return <Sheet open onClose={close} title={t("Details")}>{body}</Sheet>;
  return (
    <>
      <div className="nx-insp-scrim" aria-hidden="true" onClick={close} />
      <aside id="nx-inspector" className="nx-insp-col nx-m-sidebar" tabIndex={-1} aria-label={t("Details")}>
        <header className="nx-insp-head">
          <h2 className="nx-insp-title">{t("Details")}</h2>
          <kbd className="nx-kbd" aria-hidden="true">i</kbd>
          <button type="button" className="nx-icon-btn" aria-label={t("Close panel")} onClick={close}>
            <Icon name="x" size={20} />
          </button>
        </header>
        <div className="nx-insp-body">{body}</div>
      </aside>
    </>
  );
}
