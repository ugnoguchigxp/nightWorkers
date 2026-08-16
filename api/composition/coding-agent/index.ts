import { configureCodingAgentHost } from "../../modules/codingAgent/ports/coding-agent-host.binding";
import type { CodingAgentHostPorts } from "../../modules/codingAgent/ports/coding-agent-host.port";
import { createCodingAgentHostAdapter } from "./coding-agent-host-adapter";

export { createCodingAgentHostAdapter } from "./coding-agent-host-adapter";

/** Register the production host once; tests can supply a narrow fake instead. */
export function initializeComposedCodingAgent(host?: CodingAgentHostPorts) {
	return configureCodingAgentHost(host ?? createCodingAgentHostAdapter());
}
