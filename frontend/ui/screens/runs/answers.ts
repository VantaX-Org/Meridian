import { t } from "@/lib/v2/i18n";
import type { ChatAction } from "@/ui/kit";

export interface Answer { text: string; evidence: string[]; actions: ChatAction[] }

/** A plain answer built from numbers the screen already holds. Evidence lines are those numbers, never invented. */
export const answer = (text: string, evidence: string[], actions: ChatAction[] = []): Answer => ({ text, evidence, actions });

export const noData = (): Answer => answer(t("There is nothing here to answer from yet."), []);
