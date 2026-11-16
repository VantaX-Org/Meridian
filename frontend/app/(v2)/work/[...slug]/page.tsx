import { Work } from "@/design/next/screens/Work";

export default async function WorkPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <Work slug={slug} />;
}
