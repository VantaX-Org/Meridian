import { redirect } from "next/navigation";

/** Folded into the one fix screen; the tool opens from the query. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (v !== undefined) p.set(k, v);
  p.set("open", "triage");
  redirect(`/work?${p.toString()}`);
}
