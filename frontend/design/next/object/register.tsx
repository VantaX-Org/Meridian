/** Registers the sheet kinds of the object page. Imported by shell/sheets.ts. */
import { registerSheet } from "../shell/registry";
import { EvidenceSheet, RunSheet, RecordSheet, RuleSheet, ScoreSheet } from "./EvidenceSheet";

registerSheet("evidence", (c) => <EvidenceSheet id={c.id} close={c.close} under={c.under} />);
registerSheet("run", (c) => <RunSheet id={c.id} close={c.close} under={c.under} />);
registerSheet("score", (c) => <ScoreSheet id={c.id} close={c.close} under={c.under} />);
registerSheet("rule", (c) => <RuleSheet id={c.id} close={c.close} under={c.under} />);
registerSheet("record", (c) => <RecordSheet id={c.id} close={c.close} under={c.under} />);
