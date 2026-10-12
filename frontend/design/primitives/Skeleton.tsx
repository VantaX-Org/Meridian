export function Skeleton({ width = "100%", height = 16 }: { width?: number | string; height?: number | string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        position: "relative",
        overflow: "hidden",
        width,
        height,
        background: "var(--m-sheet-sunken)",
        borderRadius: "var(--m-radius-control)",
      }}
    >
      <span
        className="m-skeleton-sweep"
        style={{ position: "absolute", width: "40%", height: "100%", background: "var(--m-sheet-raised)" }}
      />
    </span>
  );
}
