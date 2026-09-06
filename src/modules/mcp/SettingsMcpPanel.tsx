import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, SelectField } from "@/components/settings/SettingsFields";
import { SettingsSaveActions } from "@/components/settings/SettingsSaveActions";
import { Button } from "@/components/ui/Button";
import type {
	McpServerConfig,
	McpServerTransport,
} from "../nightworkers/types";
import {
	emptyMcpForm,
	formFromMcpServer,
	mcpFormToInput,
} from "./mcpSettingsForms";
import { useMcpSettings } from "./useMcpSettings";

export function SettingsMcpPanel() {
	const { t } = useTranslation();
	const mcpSettings = useMcpSettings();
	const [mcpForm, setMcpForm] = useState(emptyMcpForm);
	const [mcpPasteText, setMcpPasteText] = useState("");
	const [mcpMessage, setMcpMessage] = useState<string>("");
	const [mcpMessageStatus, setMcpMessageStatus] = useState<
		"idle" | "success" | "error"
	>("idle");
	const [mcpBusy, setMcpBusy] = useState(false);

	const saveMcpServer = async () => {
		setMcpBusy(true);
		setMcpMessage("");
		setMcpMessageStatus("idle");
		try {
			const input = mcpFormToInput(mcpForm);
			const saved = mcpForm.id
				? await mcpSettings.updateMcpServer(mcpForm.id, input)
				: await mcpSettings.createMcpServer(input);
			setMcpForm(formFromMcpServer(saved));
			if (!saved.enabled) {
				setMcpMessage(
					"MCP Server を保存しました。OFF のため疎通テストはスキップしました",
				);
				setMcpMessageStatus("success");
				return;
			}
			const result = await mcpSettings.testMcpServer(saved.id);
			setMcpMessage(
				`MCP Server を保存しました。疎通テスト: ${result.ok ? "OK" : "NG"} ${result.message}`,
			);
			setMcpMessageStatus("success");
		} catch (err) {
			setMcpMessage(err instanceof Error ? err.message : String(err));
			setMcpMessageStatus("error");
		} finally {
			setMcpBusy(false);
		}
	};

	const importMcpServers = async () => {
		setMcpBusy(true);
		setMcpMessage("");
		setMcpMessageStatus("idle");
		try {
			const result = await mcpSettings.importMcpServers(mcpPasteText, true);
			const okCount = result.results.filter((item) => item.ok).length;
			const ngCount = result.results.length - okCount;
			if (result.servers[0]) {
				setMcpForm(formFromMcpServer(result.servers[0]));
			}
			setMcpPasteText("");
			setMcpMessage(
				`MCP Server ${result.servers.length}件を取り込みました。疎通テスト: ${okCount} OK${
					ngCount > 0 ? ` / ${ngCount} NG` : ""
				}`,
			);
			setMcpMessageStatus("success");
		} catch (err) {
			setMcpMessage(err instanceof Error ? err.message : String(err));
			setMcpMessageStatus("error");
		} finally {
			setMcpBusy(false);
		}
	};

	const toggleMcpServer = async (server: McpServerConfig, enabled: boolean) => {
		setMcpBusy(true);
		setMcpMessage("");
		setMcpMessageStatus("idle");
		try {
			const updated = await mcpSettings.updateMcpServer(server.id, { enabled });
			if (mcpForm.id === server.id) {
				setMcpForm((prev) => ({ ...prev, enabled: updated.enabled }));
			}
			if (!updated.enabled) {
				setMcpMessage(`${updated.name} をOFFにしました`);
				setMcpMessageStatus("success");
				return;
			}
			const result = await mcpSettings.testMcpServer(updated.id);
			setMcpMessage(
				`${updated.name} をONにしました。疎通テスト: ${result.ok ? "OK" : "NG"} ${result.message}`,
			);
			setMcpMessageStatus(result.ok ? "success" : "error");
		} catch (err) {
			setMcpMessage(err instanceof Error ? err.message : String(err));
			setMcpMessageStatus("error");
		} finally {
			setMcpBusy(false);
		}
	};

	const testMcpServer = async (id: string) => {
		setMcpBusy(true);
		setMcpMessage("");
		setMcpMessageStatus("idle");
		try {
			const result = await mcpSettings.testMcpServer(id);
			setMcpMessage(`${result.ok ? "OK" : "NG"} ${result.message}`);
			setMcpMessageStatus(result.ok ? "success" : "error");
		} catch (err) {
			setMcpMessage(err instanceof Error ? err.message : String(err));
			setMcpMessageStatus("error");
		} finally {
			setMcpBusy(false);
		}
	};

	return (
		<>
			<SettingsSaveActions
				onSave={() => void saveMcpServer()}
				isSaving={mcpBusy}
				saveStatus={mcpMessageStatus}
				saveMessage={mcpMessage}
			/>
			<div className="rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
				<div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
					<div className="space-y-2">
						{mcpSettings.mcpServers.length === 0 ? (
							<p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-500">
								{t("settings.mcp.empty")}
							</p>
						) : (
							mcpSettings.mcpServers.map((server) => (
								<div
									key={server.id}
									className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg border p-3 text-xs ${
										mcpForm.id === server.id
											? "border-emerald-500/60 bg-emerald-500/10 text-emerald-100"
											: "border-zinc-800 bg-zinc-900/60 text-zinc-300"
									}`}
								>
									<button
										type="button"
										onClick={() => {
											setMcpForm(formFromMcpServer(server));
											setMcpMessage("");
											setMcpMessageStatus("idle");
										}}
										className="min-w-0 text-left"
									>
										<div className="truncate font-semibold">{server.name}</div>
										<div className="mt-1 truncate text-[10px] text-zinc-500">
											{server.transport} / {server.toolPrefix}
										</div>
										{server.lastStatus ? (
											<div className="mt-1 truncate text-[10px] text-zinc-500">
												{server.lastStatus.ok ? "OK" : "NG"}:{" "}
												{server.lastStatus.message}
											</div>
										) : null}
									</button>
									<label className="inline-flex cursor-pointer items-center gap-2 text-[10px] text-zinc-500">
										<span>{server.enabled ? "ON" : "OFF"}</span>
										<input
											type="checkbox"
											className="peer sr-only"
											checked={server.enabled}
											disabled={mcpBusy}
											onChange={(event) =>
												void toggleMcpServer(
													server,
													event.currentTarget.checked,
												)
											}
										/>
										<span
											className={`relative h-5 w-9 rounded-full transition peer-disabled:opacity-50 ${
												server.enabled ? "bg-emerald-500" : "bg-zinc-700"
											}`}
										>
											<span
												className={`absolute top-1 h-3 w-3 rounded-full bg-white transition ${
													server.enabled ? "left-5" : "left-1"
												}`}
											/>
										</span>
									</label>
								</div>
							))
						)}
						<Button
							type="button"
							variant="default"
							onClick={() => {
								setMcpForm(emptyMcpForm);
								setMcpMessage("");
								setMcpMessageStatus("idle");
							}}
							className="mt-2 h-9 w-full px-4 text-xs"
						>
							{t("settings.mcp.add")}
						</Button>
					</div>

					<div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						<div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="text-xs font-semibold text-zinc-200">
										{t("settings.mcp.pasteConfig")}
									</h3>
									<p className="mt-1 text-[10px] text-zinc-500">
										{t("settings.mcp.pasteDescription")}
									</p>
								</div>
								<Button
									type="button"
									variant="ghost"
									onClick={() => void importMcpServers()}
									disabled={mcpBusy || mcpPasteText.trim().length === 0}
									className="h-8 px-3 text-xs"
								>
									{mcpBusy ? (
										<RefreshCw className="h-3 w-3 animate-spin" />
									) : null}
									{t("settings.mcp.importTest")}
								</Button>
							</div>
							<textarea
								value={mcpPasteText}
								onChange={(event) => setMcpPasteText(event.target.value)}
								rows={7}
								className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100"
								placeholder={
									'{\n  "mcpServers": {\n    "local_docs": {\n      "command": "node",\n      "args": ["server.js"]\n    }\n  }\n}'
								}
							/>
						</div>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<Field
								id="mcp-name"
								label={t("settings.field.name")}
								value={mcpForm.name}
								onChange={(value) =>
									setMcpForm((prev) => ({ ...prev, name: value }))
								}
							/>
							<Field
								id="mcp-prefix"
								label={t("settings.field.toolPrefix")}
								value={mcpForm.toolPrefix}
								onChange={(value) =>
									setMcpForm((prev) => ({ ...prev, toolPrefix: value }))
								}
							/>
							<SelectField
								id="mcp-transport"
								label={t("settings.field.transport")}
								value={mcpForm.transport}
								options={[
									{ value: "stdio", label: "stdio" },
									{ value: "sse", label: "SSE (legacy)" },
									{ value: "streamable_http", label: "Streamable HTTP" },
								]}
								onChange={(value) =>
									setMcpForm((prev) => ({
										...prev,
										transport: value as McpServerTransport,
									}))
								}
							/>
							<label className="flex items-end gap-2 pb-2 text-xs text-zinc-300">
								<input
									type="checkbox"
									checked={mcpForm.enabled}
									onChange={(event) =>
										setMcpForm((prev) => ({
											...prev,
											enabled: event.target.checked,
										}))
									}
								/>
								{t("settings.hooks.enabled")}
							</label>
							{mcpForm.transport === "stdio" ? (
								<>
									<Field
										id="mcp-command"
										label={t("settings.field.command")}
										value={mcpForm.command}
										onChange={(value) =>
											setMcpForm((prev) => ({ ...prev, command: value }))
										}
									/>
									<Field
										id="mcp-args"
										label={t("settings.field.args")}
										value={mcpForm.argsText}
										onChange={(value) =>
											setMcpForm((prev) => ({ ...prev, argsText: value }))
										}
									/>
								</>
							) : (
								<Field
									id="mcp-url"
									label={t("settings.field.url")}
									value={mcpForm.url}
									onChange={(value) =>
										setMcpForm((prev) => ({ ...prev, url: value }))
									}
								/>
							)}
							<Field
								id="mcp-cwd"
								label={t("settings.field.cwd")}
								value={mcpForm.cwd}
								onChange={(value) =>
									setMcpForm((prev) => ({ ...prev, cwd: value }))
								}
							/>
						</div>
						<div className="space-y-1.5">
							<label
								htmlFor="mcp-env"
								className="block text-[11px] font-semibold text-zinc-400"
							>
								{t("settings.field.nonSecretEnv")}
							</label>
							<textarea
								id="mcp-env"
								value={mcpForm.envText}
								onChange={(event) =>
									setMcpForm((prev) => ({
										...prev,
										envText: event.target.value,
									}))
								}
								rows={3}
								className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
								placeholder={t("settings.placeholder.keyValue")}
							/>
						</div>
						<p className="text-[10px] text-zinc-500">
							{t("settings.mcp.note")}
						</p>
						<div className="flex flex-wrap justify-end gap-2 pt-4">
							{mcpForm.id ? (
								<>
									<Button
										type="button"
										variant="ghost"
										onClick={() => void testMcpServer(mcpForm.id as string)}
										disabled={mcpBusy}
										className="h-9 px-4 text-xs"
									>
										{t("settings.mcp.testConnection")}
									</Button>
									<Button
										type="button"
										variant="ghost"
										onClick={async () => {
											if (!mcpForm.id) return;
											setMcpBusy(true);
											setMcpMessage("");
											setMcpMessageStatus("idle");
											try {
												await mcpSettings.deleteMcpServer(mcpForm.id);
												setMcpForm(emptyMcpForm);
												setMcpMessage("MCP Server を削除しました");
												setMcpMessageStatus("success");
											} catch (err) {
												setMcpMessage(
													err instanceof Error ? err.message : String(err),
												);
												setMcpMessageStatus("error");
											} finally {
												setMcpBusy(false);
											}
										}}
										disabled={mcpBusy}
										className="h-9 px-4 text-xs text-red-300"
									>
										<Trash2 className="h-3.5 w-3.5" />
										{t("settings.mcp.delete")}
									</Button>
								</>
							) : null}
						</div>
					</div>
				</div>
			</div>
			<SettingsSaveActions
				onSave={() => void saveMcpServer()}
				isSaving={mcpBusy}
				saveStatus={mcpMessageStatus}
				saveMessage={mcpMessage}
			/>
		</>
	);
}
