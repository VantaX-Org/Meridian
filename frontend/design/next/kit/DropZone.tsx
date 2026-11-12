"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { t } from "@/lib/v2/i18n";
import { Button } from "./Button";
import { Icon } from "../Icon";
import { cx } from "./cx";

/** A drop target that is also a button: drag a file in, or press Choose a file. The hint names the format. */
export function DropZone({ onFiles, accept, multiple, hint, busy, label }: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  hint: string;
  busy?: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();
  const take = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!busy) take(e.dataTransfer.files);
  };
  return (
    <div
      className={cx("nx-drop", over && "nx-drop-over")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <Icon name="upload" size={28} aria-hidden="true" />
      <div className="nx-drop-text">{label ?? t("Drop a file here")}</div>
      <div id={hintId} className="nx-drop-hint">{hint}</div>
      <Button variant="secondary" loading={busy} aria-describedby={hintId} onClick={() => input.current?.click()}>
        {t("Choose a file")}
      </Button>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
    </div>
  );
}
