import { RunCompare } from "@/ui/screens/runs/RunCompare";

const list = (v: string | string[] | undefined) => (typeof v === "string" ? v.split(",").filter(Boolean) : undefined);

export default async function Page({ params, searchParams }: { params: Promise<{ id: string; b: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id, b } = await params;
  const q = await searchParams;
  return <RunCompare a={id} b={b} runs={list(q.runs)} objects={list(q.objects)} />;
}
