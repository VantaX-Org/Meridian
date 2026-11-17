"use client";

import { BarList, Card, type BarItem } from "@/ui/kit";

/** good / warn / bad map onto the severity colours; no tone draws the data colour. */
export type Tone = "good" | "warn" | "bad";
const SEV = { good: "low", warn: "medium", bad: "critical" } as const;

export interface LeadBar { id: string; label: string; value: number; tone?: Tone }

/** The chart that leads a tab: one ranked bar list with the sentence that reads it. Nothing when every bar is zero. */
export function Lead({ tab, title, sentence, bars }: { tab: string; title: string; sentence: string; bars: LeadBar[] }) {
  if (!bars.some((b) => b.value > 0)) return null;
  const items: BarItem[] = bars.map((b) => ({ id: b.id, label: b.label, value: b.value, display: b.value.toLocaleString(), sev: b.tone ? SEV[b.tone] : undefined }));
  return (
    <div data-testid={`lead-${tab}`}>
      <Card title={title} sub={sentence}>
        <BarList items={items} label={title} />
      </Card>
    </div>
  );
}
