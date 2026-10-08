// frontend/design/templates/HomePage.tsx
import type { ReactNode } from "react";
import { Stat } from "../primitives/Stat";

export interface HomeTile {
  key: string;
  content: ReactNode;
}

export function HomePage({
  headline, headlineDelta, tiles, lists,
}: { headline: string; headlineDelta?: ReactNode; tiles: HomeTile[]; lists: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 p-6">
      <Stat label="Overview" value={headline} delta={headlineDelta} />
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {tiles.map((tile) => (
          <div key={tile.key} className="p-4 rounded border" style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}>
            {tile.content}
          </div>
        ))}
      </div>
      {lists}
    </div>
  );
}
