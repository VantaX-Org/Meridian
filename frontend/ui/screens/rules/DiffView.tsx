import "./rules.css";
import { t } from "@/lib/v2/i18n";

/** A unified diff, one line per row; added and removed lines carry a text marker as well as a tone. Kit request. */
export function DiffView({ diff, label }: { diff: string; label?: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="mx-code" tabIndex={0} aria-label={label ?? t("Changes between versions")}>
      {lines.map((l, i) => (
        <span key={i} className="mx-diff-line" data-kind={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx"}>{l}{"\n"}</span>
      ))}
    </pre>
  );
}
