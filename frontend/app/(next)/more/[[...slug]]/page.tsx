import { More } from "@/design/next/screens/More";

export default async function MorePage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <More slug={slug} />;
}
