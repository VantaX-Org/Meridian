import { getRule } from "@/lib/admin-api";
import { notFound } from "next/navigation";
import RuleEditClient from "./RuleEditClient";

export default async function RuleEditPage({
  params,
}: {
  params: Promise<{ rule_id: string }>;
}) {
  const { rule_id } = await params;

  let rule;
  try {
    rule = await getRule(rule_id);
  } catch {
    notFound();
  }

  return <RuleEditClient rule={rule} />;
}
