"use client";

import { LiveSection } from "../_live";
import { PersonaHomePage } from "../_persona-home";

export default function BasisHomePage() {
  return <PersonaHomePage role="basis" lists={<LiveSection />} />;
}
