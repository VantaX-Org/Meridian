import { MigrationRun } from "@/ui/screens/load/MigrationRun";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MigrationRun id={id} />;
}
