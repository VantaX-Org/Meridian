import "@/ui/tokens.css";
import "@/ui/kit/kit.css";
import "@/ui/auth/auth.css";
import { Standalone } from "@/ui/kit/Standalone";
import { NotFoundCard } from "@/ui/auth/NotFound";
import { plexClass } from "./fonts";

/** Unmatched URLs: no shell, so the card frames itself on the ground. One card, one action. */
export default function NotFound() {
  return (
    <div className={plexClass}>
      <Standalone>
        <NotFoundCard />
      </Standalone>
    </div>
  );
}
