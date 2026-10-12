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
