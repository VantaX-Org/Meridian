import { RunDetail } from "@/design/next/runs/RunDetail";
import { RunCanvas } from "@/design/v2/screens/Run";
import { LegacyMount } from "@/design/next/shell/LegacyMount";

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params;
  // ?view=full keeps export, report download, baseline pin, archive, rename and agent re-runs from the old run screen.
  return (await searchParams).view === "full" ? <LegacyMount><RunCanvas id={id} /></LegacyMount> : <RunDetail id={id} />;
}
