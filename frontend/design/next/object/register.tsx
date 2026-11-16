/** Registers the sheet kinds of the object page. Imported by shell/sheets.ts. */
import { registerSheet } from "../shell/registry";
import { EvidenceSheet, RunSheet, RecordSheet, RuleSheet, ScoreSheet } from "./EvidenceSheet";
import { FindingRecordsSheet, RecordDetailSheet, RuleReadsSheet } from "./RecordSheets";

registerSheet("evidence", (c) => <EvidenceSheet id={c.id} close={c.close} under={c.under} />);
// "run" is the run wizard and run detail sheet (shell/sheets.ts); this is the short object-page summary.
registerSheet("object-run", (c) => <RunSheet id={c.id} close={c.close} under={c.under} />);
registerSheet("score", (c) => <ScoreSheet id={c.id} close={c.close} under={c.under} />);
registerSheet("rule", (c) => <RuleSheet id={c.id} close={c.close} under={c.under} />);
registerSheet("record", (c) => <RecordSheet id={c.id} close={c.close} under={c.under} />);
registerSheet("record-detail", (c) => <RecordDetailSheet id={c.id} close={c.close} under={c.under} />);
registerSheet("finding-records", (c) => <FindingRecordsSheet id={c.id} close={c.close} under={c.under} />);
registerSheet("rule-reads", (c) => <RuleReadsSheet id={c.id} close={c.close} under={c.under} />);
