import { evaluatorSetFingerprint } from "./project-exploration-pilot/evaluator";
import { nativeApiToolManifestFingerprint } from "./project-exploration-pilot/protocol-fingerprints";
import { taskSetFingerprint } from "./project-exploration-pilot/registration";
import {
	pilotPromptContractFingerprint,
	PILOT_PROMPT_CONTRACT_VERSION,
	PILOT_TASKS,
} from "./project-exploration-pilot/tasks";

process.stdout.write(
	`${JSON.stringify({
		schemaVersion: "project-intelligence-value-pilot-protocol-fingerprints-v1",
		taskSet: taskSetFingerprint(PILOT_TASKS),
		evaluatorSet: evaluatorSetFingerprint(PILOT_TASKS),
		promptContract: pilotPromptContractFingerprint(),
		promptContractVersion: PILOT_PROMPT_CONTRACT_VERSION,
		toolManifest: nativeApiToolManifestFingerprint(),
	})}\n`,
);
