"use client";

/**
 * The failing records of one rule in one run: GET /findings/rules/{check_id}/records. Each row is a record key, the
 * field with its text, the value it holds and the value the rule expects. Expected is null when no fix is proposed;
 * it is never made up here. Fixture mode answers a deterministic set with no real data.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { v2Get } from "@/lib/api/v2/client";
import { fixtureActive, useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";

export interface FailingRecord {
  record_key: string;
  /** The field as the rule checks it ("MARA.MATKL"), or null when the rule is about the whole record. */
  field: string | null;
  /** The field with its text ("MARA.MATKL (Material Group)"). */
  field_text: string | null;
  current_value: string | number | boolean | null;
  expected_value: string | number | boolean | null;
}

export interface FailingRecordsPage {
  version_id: string;
  check_id: string;
  module: string;
  total: number;
  limit: number;
  offset: number;
  items: FailingRecord[];
}

const FIELD = "MARA.MATKL";
export const RECORDS_PAGE = 25;
const FIXTURE_TOTAL = 137;

export function fixtureFailingRecords(versionId: string, checkId: string, limit: number, offset: number): FailingRecordsPage {
  const n = Math.max(0, Math.min(limit, FIXTURE_TOTAL - offset));
  const items = Array.from({ length: n }, (_, i): FailingRecord => {
    const k = offset + i + 1;
    return {
      record_key: `MAT-${String(k).padStart(6, "0")}`,
      field: FIELD,
      field_text: [FIELD, t("Material group")].join(" / "),
      current_value: `OLD-${k}`,
      expected_value: k % 3 === 0 ? null : `GRP-${(k % 9) + 1}`,
    };
  });
  return { version_id: versionId, check_id: checkId, module: "material_master", total: FIXTURE_TOTAL, limit, offset, items };
}

export async function getFailingRecords(versionId: string, checkId: string, limit = RECORDS_PAGE, offset = 0): Promise<FailingRecordsPage> {
  if (fixtureActive()) return fixtureFailingRecords(versionId, checkId, limit, offset);
  return v2Get<FailingRecordsPage>(`/findings/rules/${encodeURIComponent(checkId)}/records`, { version_id: versionId, limit, offset });
}

export const failingKeys = {
  records: (fx: boolean, run: string | null, check: string | null, offset: number) => ["next", "failing-records", fx, run, check, offset] as const,
};

export function useFailingRecords(run: string | null, check: string | null, offset: number) {
  const fx = useFixture();
  return useQuery({
    queryKey: failingKeys.records(fx, run, check, offset),
    queryFn: () => getFailingRecords(run as string, check as string, RECORDS_PAGE, offset),
    enabled: !!run && !!check,
    placeholderData: keepPreviousData,
  });
}
