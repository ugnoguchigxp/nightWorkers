import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchMcpServers } from "../mcp/mcpCommands";
import type { McpServerConfig, Repository } from "../nightworkers/types";
import {
	fetchProjectExplorationSettings,
	fetchProjectSecurityIntelligenceSettings,
	type ProjectExplorationCatalogPilotSettings,
	type ProjectSecurityIntelligenceSettingsResponse,
	saveProjectExplorationSettings,
	saveProjectSecurityIntelligenceSettings,
} from "../ontology";

type SaveFeedbackStatus = "idle" | "success" | "error";

export function useProjectIntelligenceSettings(
	activeProject: Repository | null,
) {
	const { t } = useTranslation();
	const repositoryId = activeProject?.id ?? null;
	const currentRepositoryId = useRef(repositoryId);
	currentRepositoryId.current = repositoryId;
	const [securityIntelligence, setSecurityIntelligence] =
		useState<ProjectSecurityIntelligenceSettingsResponse | null>(null);
	const [securityMessage, setSecurityMessage] = useState("");
	const [securityMessageStatus, setSecurityMessageStatus] =
		useState<SaveFeedbackStatus>("idle");
	const [securityBusy, setSecurityBusy] = useState(false);
	const [projectExploration, setProjectExploration] =
		useState<ProjectExplorationCatalogPilotSettings | null>(null);
	const [explorationMessage, setExplorationMessage] = useState("");
	const [explorationMessageStatus, setExplorationMessageStatus] =
		useState<SaveFeedbackStatus>("idle");
	const [explorationBusy, setExplorationBusy] = useState(false);
	const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);

	useEffect(() => {
		if (!repositoryId) {
			setSecurityIntelligence(null);
			setSecurityMessage("");
			setSecurityMessageStatus("idle");
			setSecurityBusy(false);
			return;
		}
		let cancelled = false;
		setSecurityBusy(true);
		setSecurityMessage("");
		setSecurityMessageStatus("idle");
		void readJson<ProjectSecurityIntelligenceSettingsResponse>(
			fetchProjectSecurityIntelligenceSettings(repositoryId),
		)
			.then((settings) => {
				if (!cancelled) setSecurityIntelligence(settings);
			})
			.catch((error) => {
				if (cancelled) return;
				setSecurityIntelligence(null);
				setSecurityMessage(errorMessage(error));
				setSecurityMessageStatus("error");
			})
			.finally(() => {
				if (!cancelled) setSecurityBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [repositoryId]);

	useEffect(() => {
		if (!repositoryId) {
			setProjectExploration(null);
			setMcpServers([]);
			setExplorationMessage("");
			setExplorationMessageStatus("idle");
			setExplorationBusy(false);
			return;
		}
		let cancelled = false;
		setExplorationBusy(true);
		setExplorationMessage("");
		setExplorationMessageStatus("idle");
		void Promise.allSettled([
			readJson<ProjectExplorationCatalogPilotSettings>(
				fetchProjectExplorationSettings(repositoryId),
			),
			readJson<{ servers: McpServerConfig[] }>(fetchMcpServers()),
		]).then(([explorationResult, serverResult]) => {
			if (cancelled) return;
			if (explorationResult.status === "fulfilled") {
				setProjectExploration(explorationResult.value);
			} else {
				setProjectExploration(null);
			}
			if (serverResult.status === "fulfilled") {
				setMcpServers(serverResult.value.servers);
			} else {
				setMcpServers([]);
			}
			const errors = [explorationResult, serverResult]
				.filter(
					(result): result is PromiseRejectedResult =>
						result.status === "rejected",
				)
				.map((result) => errorMessage(result.reason));
			if (errors.length > 0) {
				setExplorationMessage(errors.join(" / "));
				setExplorationMessageStatus("error");
			}
			setExplorationBusy(false);
		});
		return () => {
			cancelled = true;
		};
	}, [repositoryId]);

	const selectedServer = mcpServers.find(
		(server) => server.id === projectExploration?.mcpServerId,
	);
	const explorationConfigurationValid =
		!projectExploration?.enabled || Boolean(selectedServer?.enabled);

	const saveSecurityIntelligence = async () => {
		if (!repositoryId || !securityIntelligence) return;
		setSecurityBusy(true);
		setSecurityMessage("");
		setSecurityMessageStatus("idle");
		try {
			const saved = await readJson<ProjectSecurityIntelligenceSettingsResponse>(
				saveProjectSecurityIntelligenceSettings(
					repositoryId,
					securityIntelligence.settings,
				),
			);
			if (currentRepositoryId.current !== repositoryId) return;
			setSecurityIntelligence(saved);
			setSecurityMessage(t("settings.securityIntelligence.saveSucceeded"));
			setSecurityMessageStatus("success");
		} catch (error) {
			if (currentRepositoryId.current !== repositoryId) return;
			setSecurityMessage(errorMessage(error));
			setSecurityMessageStatus("error");
		} finally {
			if (currentRepositoryId.current === repositoryId) setSecurityBusy(false);
		}
	};

	const saveProjectExploration = async () => {
		if (
			!repositoryId ||
			!projectExploration ||
			!explorationConfigurationValid
		) {
			return;
		}
		setExplorationBusy(true);
		setExplorationMessage("");
		setExplorationMessageStatus("idle");
		try {
			const saved = await readJson<ProjectExplorationCatalogPilotSettings>(
				saveProjectExplorationSettings(repositoryId, projectExploration),
			);
			if (currentRepositoryId.current !== repositoryId) return;
			setProjectExploration(saved);
			setExplorationMessage(t("settings.projectExploration.saveSucceeded"));
			setExplorationMessageStatus("success");
		} catch (error) {
			if (currentRepositoryId.current !== repositoryId) return;
			setExplorationMessage(errorMessage(error));
			setExplorationMessageStatus("error");
		} finally {
			if (currentRepositoryId.current === repositoryId)
				setExplorationBusy(false);
		}
	};

	return {
		securityIntelligence,
		securityMessage,
		securityMessageStatus,
		securityBusy,
		changeSecurityIntelligence(
			value: ProjectSecurityIntelligenceSettingsResponse,
		) {
			setSecurityIntelligence(value);
			setSecurityMessage("");
			setSecurityMessageStatus("idle");
		},
		saveSecurityIntelligence,
		projectExploration,
		explorationMessage,
		explorationMessageStatus,
		explorationBusy,
		mcpServers,
		explorationConfigurationValid,
		changeProjectExploration(value: ProjectExplorationCatalogPilotSettings) {
			setProjectExploration(value);
			setExplorationMessage("");
			setExplorationMessageStatus("idle");
		},
		saveProjectExploration,
	};
}

async function readJson<T>(responsePromise: Promise<Response>): Promise<T> {
	const response = await responsePromise;
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return (await response.json()) as T;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
