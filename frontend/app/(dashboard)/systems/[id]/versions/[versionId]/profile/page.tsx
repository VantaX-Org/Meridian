import { redirect } from "next/navigation";

/** The field profile now lives on the run page. Old links land on its Profile tab. */
export default async function ProfileRedirect({
  params, searchParams,
}: {
  params: Promise<{ id: string; versionId: string }>;
  searchParams: Promise<{ object?: string }>;
}) {
  const { versionId } = await params;
  const { object } = await searchParams;
  redirect(`/data/runs/${versionId}?tab=profile${object ? `&object=${encodeURIComponent(object)}` : ""}`);
}
