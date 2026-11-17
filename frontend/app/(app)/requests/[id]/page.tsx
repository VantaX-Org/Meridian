import { RequestScreen } from "@/ui/screens/requests/RequestScreen";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestScreen id={id} />;
}
