"use client";

import { useState } from "react";
import type { WorkIssue, WorkRecordDetail } from "@/lib/api/work";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { STATUS_LABEL } from "@/lib/v2/work";
import type { RowRef, useWorkActions } from "@/lib/v2/work-actions";
import { Mono, V2Link } from "@/design/v2/parts";
import { SeverityMark, type SeverityKey } from "@/design/v2/marks";
import { Button, Code } from "../../kit";
import { Dash } from "./panels-kit";

export const sev = (s: string | null | undefined): SeverityKey => (s === "critical" || s === "high" || s === "medium" || s === "low" ? s : "low");
const SHOWN_ALLOWED = 5;

type Choice = "" | "fix" | "not an issue" | "accept risk";

/** One failing rule and its fix: what the rule found, the values it accepts, what is suggested, and where to type. */
export function FixBlock({ issue, detail, row, canFix, canSign, onReason, actions }: { issue: WorkIssue; detail: WorkRecordDetail; row: RowRef; canFix: boolean; canSign: boolean; onReason: (kind: "not_an_issue" | "accept_risk", issue: WorkIssue) => void; actions: ReturnType<typeof useWorkActions> }) {
  const { hrefFor } = useOpenItem();
  const serverValue = issue.decision?.value ?? "";
  const [value, setValue] = useState(serverValue);
  const [showAll, setShowAll] = useState(false);
  const [local, setLocal] = useState<{ status?: string; value?: string } | null>(null);
  const status = local?.status ?? issue.status;
  const allowed = issue.allowed_values ?? [];
  const list = showAll ? allowed : allowed.slice(0, SHOWN_ALLOWED);
  // i18n-ignore: decision codes, shown through t(decision)
  const decision: Choice = status === "not_an_issue" ? (issue.resolution === "accepted_risk" ? "accept risk" : "not an issue") : status === "to_fix" ? "" : "fix";
  const hasSuggestion = Boolean(issue.suggestion?.value);
  const labelOf = (v: string | null | undefined) => (v ? allowed.find((a) => a.value === v)?.label ?? undefined : undefined);
  const typed = value.trim();
  // A rule with a value list accepts only those values; free text is for rules without one.
  const outside = typed !== "" && allowed.length > 0 && !allowed.some((a) => a.value === typed);
  const canSave = typed !== "" && typed !== serverValue && !outside;
  const [chosen, setChosen] = useState<Choice>(decision);
  const run = async (kind: "accept" | "edit", v?: string) => {
    setLocal({ status: "proposed", value: v ?? issue.suggestion?.value });
    const ok = await actions.decide([row], kind, { value: v });
    if (!ok) setLocal(null);
  };
  const apply = () => {
    if (chosen === "fix") {
      if (canSave) void run("edit", typed);
      else if (hasSuggestion) void run("accept");
      else void actions.decide([{ ...row, suggested_value: null }], "accept");
    } else if (chosen === "not an issue") onReason("not_an_issue", issue);
    else if (chosen === "accept risk") onReason("accept_risk", issue);
  };
  const fieldName = issue.field ? sapField(issue.field) : null;
  const listId = `allowed-${issue.check_id}`;
  return (
    <section className="nx-rc-fix" aria-label={t("Fix for {check_id}", { check_id: issue.check_id })} data-testid="fix-block">
      <dl className="nx-ib-facts">
        <div className="nx-ib-fact">
          <dt>{t("Rule")}</dt>
          <dd className="nx-rc-line">
            <V2Link href={hrefFor({ kind: "rule", id: issue.check_id })}>
              <Mono>{issue.check_id}</Mono>
            </V2Link>
            <SeverityMark severity={sev(issue.severity)} />
            <span>{issue.message}</span>
          </dd>
        </div>
        <div className="nx-ib-fact">
          <dt>{t("Field")}</dt>
          <dd>{fieldName ? <Code code={fieldName} text={describeField(issue.field ?? "", detail.field_descriptions) ?? undefined} /> : <span className="nx-ib-meta">—</span>}</dd>
        </div>
        {issue.failing != null ? (
          <div className="nx-ib-fact">
            <dt>{t("In this run")}</dt>
            <dd>{t("{failing} {failing2, plural, one {record fails} other {records fail}}{value}", { failing: int(issue.failing), failing2: issue.failing, value: issue.population ? t(" of {population} checked", { population: int(issue.population) }) : "" })}</dd>
          </div>
        ) : null}
        <div className="nx-ib-fact">
          <dt>{t("Current value")}</dt>
          <dd>{issue.current_value ? <Code code={issue.current_value} text={labelOf(issue.current_value)} /> : <span className="nx-ib-meta">{t("blank")}</span>}</dd>
        </div>
        <div className="nx-ib-fact">
          <dt>{t("Possible values")}</dt>
          <dd>
            {allowed.length === 0 ? (
              <span className="nx-ib-meta">{t("The rule does not list values")}</span>
            ) : (
              <>
                <ul className="nx-ib-list">
                  {list.map((a) => (
                    <li key={a.value}>
                      <Code code={a.value} text={a.label ?? undefined} />
                    </li>
                  ))}
                </ul>
                {allowed.length > SHOWN_ALLOWED ? (
                  <Button variant="quiet" size={32} onClick={() => setShowAll((v) => !v)}>
                    {showAll ? t("Show fewer") : t("Show all {allowedCount}", { allowedCount: allowed.length })}
                  </Button>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div className="nx-ib-fact">
          <dt>{t("Suggested value")}</dt>
          <dd>
            {issue.suggestion?.value ? (
              <span className="nx-rc-line">
                <Code code={issue.suggestion.value} text={labelOf(issue.suggestion.value)} />
                {issue.suggestion.why ? <span className="nx-ib-meta">{issue.suggestion.why}</span> : null}
              </span>
            ) : (
              <span className="nx-ib-meta">{t("none for this row")}</span>
            )}
          </dd>
        </div>
        <div className="nx-ib-fact">
          <dt>{t("New value")}</dt>
          {canFix ? (
            <dd className="nx-rc-edit">
              <input
                type="text"
                className="nx-rc-input"
                aria-label={t("New value for {check_id}", { check_id: issue.check_id })}
                aria-invalid={outside || undefined}
                placeholder={allowed.length ? t("Pick or type an allowed value") : t("Type a value")}
                list={allowed.length ? listId : undefined}
                value={local?.value ?? value}
                spellCheck={false}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSave) {
                    e.preventDefault();
                    void run("edit", typed);
                  }
                }}
              />
              {allowed.length ? (
                <datalist id={listId}>
                  {allowed.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label ?? a.value}
                    </option>
                  ))}
                </datalist>
              ) : null}
              <Button size={32} disabled={!canSave} onClick={() => void run("edit", typed)}>
                {t("Save")}
              </Button>
              {outside ? (
                <span role="alert" className="nx-rc-bad" data-testid="new-value-outside">
                  {t("{value} is not one of the values this rule accepts.", { value: typed })}
                </span>
              ) : null}
            </dd>
          ) : (
            <dd>{serverValue ? <Mono>{serverValue}</Mono> : <Dash why={t("Read-only for your role")} />}</dd>
          )}
        </div>
        <div className="nx-ib-fact">
          <dt>{t("Decision")}</dt>
          {canFix || canSign ? (
            <dd className="nx-rc-edit">
              <select className="nx-rc-input" aria-label={t("Decision for {check_id}", { check_id: issue.check_id })} value={chosen} onChange={(e) => setChosen(e.target.value as Choice)}>
                {decision === "" ? <option value="">{t("Decide")}</option> : null}
                <option value="fix" disabled={!canFix}>{t("fix")}</option>
                <option value="not an issue" disabled={!canSign}>{t("not an issue")}</option>
                <option value="accept risk" disabled={!canSign}>{t("accept risk")}</option>
              </select>
              <Button size={32} disabled={chosen === "" || chosen === decision || (chosen === "fix" && outside)} onClick={apply}>
                {t("Apply")}
              </Button>
            </dd>
          ) : (
            <dd>{decision ? t(decision) : "—"}</dd>
          )}
        </div>
        <div className="nx-ib-fact">
          <dt>{t("Status")}</dt>
          <dd>{STATUS_LABEL[status] ?? status}</dd>
        </div>
        {detail.assignee_email ? (
          <div className="nx-ib-fact">
            <dt>{t("Assigned to")}</dt>
            <dd>{detail.assignee_email}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
