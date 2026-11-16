import { redirect } from "next/navigation";

/** The old address; the data requests screen now lives under More. */
export default function DataRequestsPage() {
  redirect("/more/data-requests");
}
