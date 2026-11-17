import { Screen } from "@/ui/screens/object-tabs/Screen";

export default async function Page({ params }: { params: Promise<{ system: string; module: string }> }) {
  const { system, module } = await params;
  return <Screen tab="processes" system={system} module={module} />;
}
