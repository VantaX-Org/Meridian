import { System } from "@/ui/screens/systems/System";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <System id={id} />;
}
