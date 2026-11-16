import { ComparePage } from "@/design/next/runs/CompareSheet";

export default async function CompareRoute({ params, searchParams }: { params: Promise<{ id: string; b: string }>; searchParams: Promise<{ runs?: string; objects?: string }> }) {
  const { id, b } = await params;
  const q = await searchParams;
  return <ComparePage a={id} b={b} runs={q.runs ?? null} objects={q.objects ?? null} />;
}
