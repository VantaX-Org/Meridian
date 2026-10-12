import type { TextareaHTMLAttributes } from "react";

/** Multi-line text input styled like `Input`. Wrap in `Field` for a visible label. */
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={className ? `m-input m-textarea ${className}` : "m-input m-textarea"} />;
}
