import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import { StandaloneRoot } from "@/design/v2/shell/Standalone";
import { NotFoundCard } from "@/design/v2/auth/NotFound";

/** Unmatched URLs: no shell, so the card frames itself on the ground. One card, one action. */
export default function NotFound() {
  return (
    <StandaloneRoot>
      <NotFoundCard />
    </StandaloneRoot>
  );
}
