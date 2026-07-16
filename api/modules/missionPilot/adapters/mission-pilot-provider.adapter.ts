import type { StructuredProviderExecutionPolicy } from "../../agentsShare";

export const missionPilotToolTurnProviderExecutionPolicy: StructuredProviderExecutionPolicy =
	{
		isolatedHome: true,
		enableMcp: false,
		enableMemory: false,
		allowProviderTools: true,
		developerInstructions: [
			"Mission Pilotのtool判断専用レーンです。",
			"渡されたSystem Context、conversation、利用可能toolだけを根拠に、指定された構造化応答を返してください。",
			"MCP、command、filesystem、network、その他のtoolを直接実行しないでください。",
			"必要な情報取得と操作はtoolCallsへ出力し、NightWorkers側の権限・revision・idempotency検証に委ねてください。",
			"Memory、AGENTS.md、workspaceを探索しないでください。",
		].join("\n"),
	};

export const missionPilotArtifactProviderExecutionPolicy: StructuredProviderExecutionPolicy =
	{
		isolatedHome: true,
		enableMcp: false,
		enableMemory: false,
		allowProviderTools: false,
		developerInstructions: [
			"Mission Pilotの構造化Artifact生成専用レーンです。",
			"渡されたSystemContext、User Prompt、JSON schemaだけを根拠に、要求された構造化応答を返してください。",
			"Memory、AGENTS.md、workspace、filesystem、command、network、MCPを探索しないでください。",
			"tool callを行わず、schemaに適合する応答本文だけを返してください。",
		].join("\n"),
	};
