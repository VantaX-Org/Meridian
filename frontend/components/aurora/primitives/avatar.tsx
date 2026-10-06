/**
 * Aurora <Avatar> primitive — WS2.
 *
 * Circular user glyph at three sizes. Takes an optional `src`; falls back
 * to a single-letter monogram from `name`. No colour ramps, no coded rings
 * — identity is signalled by the name + ring only where explicit.
 */

import Image from "next/image";
import { clsx } from "./internal";

export type AvatarSize = "sm" | "md" | "lg";

// Matches the CSS sizes; the stylesheet scales the img to fill the circle.
const AVATAR_PX: Record<AvatarSize, number> = { sm: 24, md: 32, lg: 40 };

export interface AvatarProps {
  /** Image source. When omitted, renders a monogram from `name`. */
  src?: string;
  /** User's display name. First initial is used for the fallback. */
  name: string;
  size?: AvatarSize;
  className?: string;
}

export function Avatar({ src, name, size = "md", className }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={clsx("aurora-avatar", className)}
      data-size={size}
      aria-label={name}
      title={name}
    >
      {src ? (
        <Image src={src} alt={name} width={AVATAR_PX[size]} height={AVATAR_PX[size]} unoptimized />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
    </span>
  );
}
