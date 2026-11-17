import { MatchCluster } from "@/ui/screens/mdm/MatchCluster";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MatchCluster id={id} />;
}
