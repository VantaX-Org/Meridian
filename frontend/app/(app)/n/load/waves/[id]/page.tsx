import { Wave } from "@/ui/screens/load/Wave";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Wave id={id} />;
}
