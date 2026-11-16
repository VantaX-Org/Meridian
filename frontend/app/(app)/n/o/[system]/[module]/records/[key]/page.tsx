import { Screen } from "@/ui/screens/object-tabs/Screen";

export default async function Page({ params }: { params: Promise<{ system: string; module: string; key: string }> }) {
  const { system, module, key } = await params;
  return <Screen tab="record" system={system} module={module} recordKey={decodeURIComponent(key)} />;
}
