import { GoldenRecord } from "@/ui/screens/mdm/GoldenRecord";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GoldenRecord id={id} />;
}
