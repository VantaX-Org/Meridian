import { RunCompare } from "@/ui/screens/runs/RunCompare";

export default async function Page({ params }: { params: Promise<{ id: string; b: string }> }) {
  const { id, b } = await params;
  return <RunCompare a={id} b={b} />;
}
