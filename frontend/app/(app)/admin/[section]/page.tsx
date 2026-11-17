import { AdminSectionScreen } from "@/ui/screens/admin/Admin";

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return <AdminSectionScreen slug={section} />;
}
