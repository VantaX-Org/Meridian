import { ComparePage } from "@/design/next/runs/CompareSheet";
import { CompareCanvas } from "@/design/v2/screens/Compare";
import { LegacyMount } from "@/design/next/shell/LegacyMount";

export default async function CompareRoute({ params, searchParams }: { params: Promise<{ id: string; b: string }>; searchParams: Promise<{ runs?: string; objects?: string; view?: string }> }) {
  const { id, b } = await params;
  const q = await searchParams;
  // ?view=full keeps the rule-level and record-level comparison from the old compare screen.
  if (q.view === "full") return <LegacyMount><CompareCanvas a={id} b={b} /></LegacyMount>;
  return <ComparePage a={id} b={b} runs={q.runs ?? null} objects={q.objects ?? null} />;
}
