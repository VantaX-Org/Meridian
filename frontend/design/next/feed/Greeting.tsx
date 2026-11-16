"use client";

import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Button } from "../kit";
import { greetingWord, lede } from "./model";

/** Time-of-day word, first name, one generated sentence, and the two header actions. */
export function Greeting({ name, needs, running, hour = new Date().getHours(), onCompare, onObjects, next }: { name: string; needs: number; running: number; hour?: number; onCompare: () => void; onObjects: () => void; next?: ReactNode }) {
  const first = name.trim().split(/\s+/)[0];
  return (
    <header className="nx-fd-greet">
      <div>
        <h1>{first ? t("{word}, {name}", { word: greetingWord(hour), name: first }) : greetingWord(hour)}</h1>
        <p>{lede(needs, running)}</p>
        {next ? <div className="nx-fd-next">{next}</div> : null}
      </div>
      <div className="nx-fd-greet-actions">
        <Button variant="quiet" size={32} onClick={onCompare}>{t("Compare")}</Button>
        <Button variant="quiet" size={32} icon="chevron-down" onClick={onObjects}>{t("Objects")}</Button>
      </div>
    </header>
  );
}
