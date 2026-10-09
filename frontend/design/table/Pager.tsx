import { Button } from "../primitives/Button";

export function Pager({
  page, pageCount, onPageChange,
}: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  return (
    <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--m-ink-2)" }}>
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </Button>
      <span>
        Page {page} of {pageCount}
      </span>
      <Button variant="secondary" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        Next
      </Button>
    </div>
  );
}
