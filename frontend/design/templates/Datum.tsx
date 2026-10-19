// frontend/design/templates/Datum.tsx
//
// The Datum: the page composition. One vertical line, the meridian, runs the height of the page between the
// numbers and their margin. The main column holds the figures, the charts and the tables; the margin column
// holds the sentences that explain them. Below the container's reading width the margin sits first.
import type { ReactNode } from "react";

export function Datum({ margin, children }: { margin?: ReactNode; children: ReactNode }) {
  return (
    <div className="m-datum" data-margin={margin ? "true" : undefined}>
      <div className="m-datum-main min-w-0">{children}</div>
      {margin && <div className="m-datum-margin min-w-0">{margin}</div>}
    </div>
  );
}
