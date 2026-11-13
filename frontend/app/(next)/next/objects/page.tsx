import type { Metadata } from "next";
import { ObjectsList } from "@/design/next/screens/ObjectsList";

export const metadata: Metadata = { title: "Objects" };

export default function ObjectsPage() {
  return <ObjectsList />;
}
