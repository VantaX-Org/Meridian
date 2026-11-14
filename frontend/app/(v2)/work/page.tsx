import { WorkCanvas } from "@/design/v2/screens/Work";
import { Work } from "@/design/next/screens/Work";
import { NextSwap } from "@/design/next/runs/NextSwap";

export default function WorkPage() {
  return <NextSwap next={Work} old={WorkCanvas} />;
}
