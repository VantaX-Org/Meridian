import type { PillTone } from "@/design";
import type { WaveVerdict } from "@/types/api";

export const VERDICT_TONE: Record<WaveVerdict, PillTone> = { go: "go", at_risk: "at-risk", no_go: "no-go" };
export const VERDICT_LABEL: Record<WaveVerdict, string> = { go: "Go", at_risk: "At risk", no_go: "No-go" };
