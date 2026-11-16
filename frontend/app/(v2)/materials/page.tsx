import { redirect } from "next/navigation";

/** The old address; the materials screen now lives under More. */
export default function MaterialsPage() {
  redirect("/more/materials");
}
