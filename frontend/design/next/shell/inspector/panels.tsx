import "./panels.css";
import type { BodyProps } from "./frame";
import { PreferencesBody } from "./panels-prefs";
import { HelpBody } from "./panels-help";
import { TriageBody } from "./panels-triage";
import { InboxBody } from "./panels-inbox";
import { WavesBody } from "./panels-waves";
import { AwayBody, BalanceBody } from "./panels-work";
import { ContractBody, ContractsBody } from "./panels-contract";

export const PANELS_BODIES: Record<string, React.ComponentType<BodyProps>> = {
  preferences: PreferencesBody,
  help: HelpBody,
  triage: TriageBody,
  inbox: InboxBody,
  waves: WavesBody,
  away: AwayBody,
  balance: BalanceBody,
  contract: ContractBody,
  contracts: ContractsBody,
};
