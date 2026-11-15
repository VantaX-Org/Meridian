import { WorkSwap } from "@/design/next/work/WorkSwap";

export default async function WorkSlugPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return <WorkSwap slug={slug} />;
}
