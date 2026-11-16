import { t } from "@/lib/v2/i18n";

/** Read-only rule YAML. Kit request: promote to ui/kit when a second batch needs it. */
export function YamlView({ text, label }: { text: string; label?: string }) {
  return <pre className="mx-code" tabIndex={0} aria-label={label ?? t("Rule definition")}>{text}</pre>;
}
