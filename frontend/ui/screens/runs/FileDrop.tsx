"use client";

import { useRef, useState } from "react";
import { t } from "@/lib/v2/i18n";
import "./runs.css";

/** A file picker with a drop target. Local to batch 3 until the kit has one. */
export function FileDrop({ accept, file, onFile, label, hint }: { accept: string; file: File | null; onFile: (f: File | null) => void; label: string; hint?: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className="rn-drop"
      data-over={over}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0] ?? null); }}
    >
      <strong>{label}</strong>
      <span className="mx-muted">{file ? t("{name} ({kb} KB)", { name: file.name, kb: Math.max(1, Math.round(file.size / 1024)) }) : hint ?? t("Drop the file here, or choose it.")}</span>
      <input ref={input} type="file" accept={accept} aria-label={label} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </div>
  );
}
