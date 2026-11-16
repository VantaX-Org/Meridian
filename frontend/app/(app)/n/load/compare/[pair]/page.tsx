import { Pair } from "@/ui/screens/load/Pair";
export default async function Page({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params;
  return <Pair id={pair} />;
}
