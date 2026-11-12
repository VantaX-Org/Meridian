import type { Metadata } from "next";
import { KitPage } from "@/design/next/KitPage";

export const metadata: Metadata = { title: "Kit" };

export default function Page() {
  return <KitPage />;
}
