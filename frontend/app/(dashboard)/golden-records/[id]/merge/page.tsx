import { redirect } from "next/navigation";

/** The explanation lives on the golden record page now. */
export default async function GoldenRecordMergeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/golden-records/${encodeURIComponent(id)}?tab=merge`);
}
