import { Agreement } from "@/design/next/runs/Agreement";

export default async function AgreementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string }> }) {
  const [{ id }, { run }] = await Promise.all([params, searchParams]);
  return <Agreement versionId={id} run={run} />;
}
