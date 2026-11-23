"use client";

import { useId, useState } from "react";
import { errorSentence } from "@/lib/api/v2/client";
import { t } from "@/lib/v2/i18n";
import { Popover } from "./Popover";
import { useToast } from "./Toast";

export interface ExportFormat { id: string; label: string; hint?: string }

/**
 * The one export control. It lists only the formats the endpoint offers, runs `onExport(format)` (which must download and
 * return the saved file name), toasts the name, and on failure shows the reason with Retry. `count` makes the button read "Export N rows".
 */
export function ExportMenu({ formats, onExport, count, summary, personalData, disabled, label, triggerLabel }: {
  formats: ExportFormat[]; onExport: (format: string) => Promise<unknown>;
  count?: number; summary?: string; personalData?: boolean; disabled?: boolean; label?: string; triggerLabel?: string;
}) {
  const toast = useToast();
  const name = useId();
  const [fmt, setFmt] = useState(formats[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = label ?? t("Export");
  const go = async (close: () => void) => {
    setBusy(true); setError("");
    try {
      const r = await onExport(fmt);
      const file = typeof r === "string" ? r : (r as { filename?: string } | undefined)?.filename;
      toast(file ? t("Saved {name}.", { name: file }) : t("The file is ready."), "good");
      close();
    } catch (e) { setError(errorSentence(e, t("The export could not be saved"))); }
    finally { setBusy(false); }
  };
  return (
    <Popover label={title} align="end" panelClassName="mx-export" triggerClassName="mx-btn" triggerProps={{ "data-variant": "secondary" }}
      trigger={<>{triggerLabel ?? title}</>}>
      {(close) => (
        <div className="mx-export-body">
          <fieldset className="mx-export-fmt" disabled={busy}>
            <legend className="mx-field-l">{t("Format")}</legend>
            {formats.map((f) => (
              <label key={f.id} className="mx-export-opt">
                <input type="radio" name={name} value={f.id} checked={fmt === f.id} onChange={() => setFmt(f.id)} />
                <span>{f.label}{f.hint ? <span className="mx-muted">{` ${f.hint}`}</span> : null}</span>
              </label>
            ))}
          </fieldset>
          {summary ? <p className="mx-muted">{summary}</p> : null}
          {personalData ? <p className="mx-muted">{t("This file holds personal data. The export is recorded in the audit log.")}</p> : null}
          {error ? <p className="mx-field-e" role="alert">{error}</p> : null}
          <button type="button" className="mx-btn" data-variant="primary" disabled={disabled || busy || !fmt} onClick={() => void go(close)}>
            {error ? t("Retry") : count === undefined ? t("Export") : t("Export {n} rows", { n: count })}
          </button>
        </div>
      )}
    </Popover>
  );
}
