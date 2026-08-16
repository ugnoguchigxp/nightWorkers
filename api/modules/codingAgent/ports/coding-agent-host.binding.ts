import type { CodingAgentHostPorts } from "./coding-agent-host.port";

let configuredHost: CodingAgentHostPorts | null = null;

/**
 * Composition root が一度だけ実 host を登録する。fallback は置かず、standalone
 * test では明示的に fake を渡すため、Coding Agent は host private source に戻らない。
 */
export function configureCodingAgentHost(host: CodingAgentHostPorts) {
	configuredHost = host;
	return () => {
		if (configuredHost === host) configuredHost = null;
	};
}

export function requireCodingAgentHost(): CodingAgentHostPorts {
	if (!configuredHost)
		throw new Error(
			"Coding Agent host is unavailable. Initialize api/composition/coding-agent before invoking the runtime.",
		);
	return configuredHost;
}

export function clearCodingAgentHostForTest() {
	configuredHost = null;
}
