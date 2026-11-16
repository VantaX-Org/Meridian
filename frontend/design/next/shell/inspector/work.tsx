"use client";

import type React from "react";
import type { BodyProps } from "./frame";
import { JobBodyView } from "./work-job";
import { BatchBodyView } from "./work-batch";
import { RequestBodyView } from "./work-request";
import { StepBodyView } from "./work-step";
import { PersonBodyView } from "./work-person";
import { CertificateBodyView } from "./work-cert";
import "./work.css";

/** Inspector bodies of the work group, keyed by the `?open=<kind>:<id>` kind. */
export const WORK_BODIES: Record<string, React.ComponentType<BodyProps>> = {
  job: JobBodyView,
  batch: BatchBodyView,
  request: RequestBodyView,
  step: StepBodyView,
  person: PersonBodyView,
  certificate: CertificateBodyView,
};
