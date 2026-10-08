export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center" style={{ color: "var(--m-critical)" }}>
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="px-3 py-1.5 rounded border" style={{ borderColor: "var(--m-line)" }}>
          Retry
        </button>
      )}
    </div>
  );
}
