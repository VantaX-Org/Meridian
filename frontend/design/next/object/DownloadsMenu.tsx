"use client";

/** The Downloads menu of an object: each file says what it is for. Opens on `d` and on the `nx:download` event. */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/design/next/kit";
import { V2Link } from "@/design/v2/parts";
import { downloadFixSheet } from "@/lib/api/work";
import { downloadCleaningWorkbook } from "@/lib/api/next/runs";
import { t } from "@/lib/v2/i18n";
import type { ObjectRun } from "./useObjectRun";

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function DownloadsMenu({ o, open, onOpen }: { o: ObjectRun; open: boolean; onOpen: (v: boolean) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onOpen(false);
      if (e.key === "d" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) onOpen(true);
    };
    const away = (e: MouseEvent) => { if (open && box.current && !box.current.contains(e.target as Node)) onOpen(false); };
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", away);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("mousedown", away); };
  }, [open, onOpen]);

  const run = async (id: string, job: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try { await job(); onOpen(false); } catch { setError(t("The file could not be downloaded. Try again.")); } finally { setBusy(null); }
  };
  const id = o.runId;

  return (
    <div className="nx-dl" ref={box} data-testid="downloads">
      <Button variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => onOpen(!open)}>{t("Downloads")}</Button>
      {open ? (
        <div role="menu" aria-label={t("Downloads")} className="nx-dl-menu nx-card" data-testid="downloads-menu">
          <button type="button" role="menuitem" className="nx-dl-item" disabled={!id || busy !== null} onClick={() => id && void run("clean", () => downloadCleaningWorkbook(id, o.module))}>
            <strong>{t("Cleaning workbook")}</strong>
            <span>{t("The template, the instructions and the records that fail. Fix it in Excel, then add it again.")}</span>
          </button>
          <button type="button" role="menuitem" className="nx-dl-item" disabled={!id || busy !== null} onClick={() => id && void run("fix", () => downloadFixSheet({ version_id: id, module: o.module }))}>
            <strong>{t("Fix workbook")}</strong>
            <span>{t("Every record to fix with the value at risk, to work through as a list.")}</span>
          </button>
          <V2Link role="menuitem" className="nx-dl-item" href={id ? `/load?run=${encodeURIComponent(id)}` : "/load"}>
            <strong>{t("Export in load order")}</strong>
            <span>{t("The cleaned data in the order the new system loads it.")}</span>
          </V2Link>
          {error ? <p role="alert" className="nx-error-line">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
