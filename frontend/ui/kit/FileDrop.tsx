"use client";

import { useState } from "react";

/** A file picker with a drop target. `status` is the line under the label: the hint, or the chosen file's name and size. */
export function FileDrop({ accept, onFile, label, status }: { accept: string; onFile: (f: File | null) => void; label: string; status: string }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className="mx-drop"
      data-over={over}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0] ?? null); }}
    >
      <strong>{label}</strong>
      <span className="mx-muted">{status}</span>
      <input type="file" accept={accept} aria-label={label} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </div>
  );
}
