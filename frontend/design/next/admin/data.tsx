"use client";

import type { ComponentType } from "react";
import "./data.css";
import { AuditSection } from "./data-audit";
import { ConfigBundleSection, RulesIoSection, StewardshipSection } from "./data-capabilities";
import { ContactVerifySection } from "./data-contact";
import { MappingsSection } from "./data-mappings";
import { MatchRulesSection } from "./data-match";
import { RuleAccuracySection } from "./data-accuracy";
import { ReferenceSection } from "./data-reference";

/** Admin data group: slug to native section. Admin.tsx checks section.needs before rendering. */
export const DATA_SECTIONS: Record<string, ComponentType> = {
  mappings: MappingsSection,
  reference: ReferenceSection,
  audit: AuditSection,
  contactverify: ContactVerifySection,
  matchrules: MatchRulesSection,
  ruleaccuracy: RuleAccuracySection,
  stewardship: StewardshipSection,
  configbundle: ConfigBundleSection,
  rulesio: RulesIoSection,
};
