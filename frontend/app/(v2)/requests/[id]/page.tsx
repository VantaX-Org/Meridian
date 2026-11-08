import { redirect } from "next/navigation";

/** `/requests/new` and `/requests/{id}` are the addresses people and emails use; the list opens the request in its panel. */
export default async function RequestAddress({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(id === "new" ? "/requests" : `/requests?open=request:${encodeURIComponent(decodeURIComponent(id))}`);
}
