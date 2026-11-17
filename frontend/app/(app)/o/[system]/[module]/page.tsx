import { ObjectScreen } from "@/ui/screens/object/ObjectScreen";

export default async function Page({ params }: { params: Promise<{ system: string; module: string }> }) {
  const { system, module } = await params;
  return <ObjectScreen system={system} module={module} />;
}
