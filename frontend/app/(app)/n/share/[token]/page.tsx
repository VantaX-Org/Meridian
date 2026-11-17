import { Share } from "@/ui/screens/people/Share";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Share token={token} />;
}
