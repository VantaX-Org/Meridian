import { Agreement } from "@/ui/screens/runs/Agreement";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Agreement id={id} />;
}
