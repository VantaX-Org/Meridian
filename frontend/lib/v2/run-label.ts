import { t } from "@/lib/v2/i18n";

/** What a run's status says in words. `agents_complete` is a finished run Aletheia has also checked. */
export function runStatusWord(status: string | undefined): string {
  switch (status) {
    case "running":
      return t("Running");
    case "failed":
      return t("Failed");
    case "archived":
      return t("Archived");
    case "agents_complete":
      return t("Finished, Aletheia checked");
    default:
      return t("Finished");
  }
}

/** "SAP ECC run 12": the run's name; the date is secondary text beside it. */
export function runLabel(system: string | null | undefined, runNumber: number | null | undefined): string {
  if (runNumber == null) return system ? t("{system} run", { system }) : t("Run");
  return system ? t("{system} run {n}", { system, n: runNumber }) : t("Run {n}", { n: runNumber });
}
