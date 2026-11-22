import { Suspense } from "react";
import { Monitor } from "@/ui/screens/insights/Monitor";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Monitor set="controls" />
    </Suspense>
  );
}
