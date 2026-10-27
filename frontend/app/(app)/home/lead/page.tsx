"use client";

import { PersonaHomePage } from "../_persona-home";
import { HomeAnalyses } from "../_analyses";

export default function LeadHomePage() {
  // Root causes, S/4 migration and the cleansing funnel moved here from the retired Insights overview.
  return <PersonaHomePage role="lead" lists={<HomeAnalyses />} />;
}
