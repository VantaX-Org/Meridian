import { Run } from "@/ui/screens/runs/Run";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Run id={id} />;
}
