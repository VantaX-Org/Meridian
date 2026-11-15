import { ObjectsCanvas } from "@/design/v2/screens/Objects";
import { ObjectsBoard } from "@/design/next/screens/ObjectsBoard";
import { NextSwap } from "@/design/next/runs/NextSwap";

export default function ObjectsPage() {
  return <NextSwap next={ObjectsBoard} old={ObjectsCanvas} />;
}
