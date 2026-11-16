import { redirect } from "next/navigation";

/** The old address; the rule dry run is now a segment of Rules. */
export default function RuleDryRunPage() {
  redirect("/more/rules?tab=dry-run");
}
