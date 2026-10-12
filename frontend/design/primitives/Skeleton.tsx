export function Skeleton({
  width = "100%",
  height = 16,
  hero = false,
}: {
  width?: number | string;
  height?: number | string;
  /** Hero skeleton: translucent fill and sweep from the hero tokens, for use inside `.m-hero`. */
  hero?: boolean;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        position: "relative",
        overflow: "hidden",
        width,
        height,
        background: hero ? "var(--m-hero-skeleton)" : "var(--m-sheet-sunken)",
        borderRadius: "var(--m-radius-control)",
      }}
    >
      <span
        className="m-skeleton-sweep"
        style={{ position: "absolute", width: "40%", height: "100%", background: hero ? "var(--m-hero-skeleton-sweep)" : "var(--m-sheet-raised)" }}
      />
    </span>
  );
}

/** Stat tile placeholder: same 84px (112px hero) box as the real tile. */
export function StatSkeleton({ hero = false }: { hero?: boolean }) {
  return (
    <div aria-hidden className={hero ? "m-stat m-stat-hero" : "m-stat"} style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <Skeleton width="45%" height={12} hero={hero} />
      <Skeleton width="30%" height={hero ? 48 : 26} hero={hero} />
    </div>
  );
}

/** n table-row placeholders at the 36px row height. */
export function TableRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center" style={{ height: 36, padding: "0 var(--m-space-3)" }}>
          <Skeleton width={`${60 + ((i * 17) % 35)}%`} height={12} />
        </div>
      ))}
    </div>
  );
}
