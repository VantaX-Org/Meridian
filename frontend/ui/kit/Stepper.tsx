export interface Step { id: string; label: string }

/** A numbered progress list; steps before `current` are done. */
export function Stepper({ steps, current, label }: { steps: Step[]; current: number; label: string }) {
  return (
    <ol className="mx-stepper" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.id} data-state={i < current ? "done" : i === current ? "current" : "todo"} aria-current={i === current ? "step" : undefined}>
          <span className="mx-step-n" aria-hidden="true">{i < current ? "\u2713" : i + 1}</span>{s.label}
        </li>
      ))}
    </ol>
  );
}
