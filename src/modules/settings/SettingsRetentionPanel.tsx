import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type { GeneralSettings } from "../nightworkers/types";
import {
	executeDataRetentionCleanup,
	previewDataRetentionCleanup,
} from "./settingsCommands";

type RetentionCleanupPreview = {
	previewId: string;
	settingsRevision: number;
	deletable: {
		detailRows: number;
		estimatedDatabaseBytes: number;
	};
	protected: {
		activeRuns: number;
		reviewPendingRuns: number;
		closeoutPendingRuns: number;
		needsHumanRuns: number;
	};
};

export function SettingsRetentionPanel(input: {
	value: GeneralSettings;
	onChange: (next: GeneralSettings) => void;
}) {
	const { t } = useTranslation();
	const [preview, setPreview] = useState<RetentionCleanupPreview | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");

	const loadPreview = async () => {
		setBusy(true);
		setMessage("");
		try {
			const response = await previewDataRetentionCleanup();
			if (!response.ok) throw new Error(await response.text());
			setPreview((await response.json()) as RetentionCleanupPreview);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};
	const executeCleanup = async () => {
		if (!preview) return;
		setBusy(true);
		setMessage("");
		try {
			const response = await executeDataRetentionCleanup({
				previewId: preview.previewId,
				expectedSettingsRevision: preview.settingsRevision,
				idempotencyKey:
					globalThis.crypto?.randomUUID?.() ??
					`cleanup-${Date.now()}-${Math.random()}`,
				reclaimDiskSpace: "incremental",
			});
			if (!response.ok) throw new Error(await response.text());
			const result = (await response.json()) as {
				runsPurged: number;
				detailRowsDeleted: number;
			};
			setMessage(t("settings.general.retention.cleanupSucceeded", result));
			setPreview(null);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
			<div>
				<div className="text-xs font-semibold text-zinc-100">
					{t("settings.general.retention.title")}
				</div>
				<p className="mt-1 text-[10px] text-zinc-500">
					{t("settings.general.retention.description")}
				</p>
			</div>
			<label
				htmlFor="coding-agent-full-record-days"
				className="block text-xs text-zinc-300"
			>
				{t("settings.general.retention.days")}
				<input
					id="coding-agent-full-record-days"
					type="number"
					min={1}
					max={365}
					value={input.value.dataRetention?.codingAgentFullRecordDays ?? 7}
					onChange={(event) =>
						input.onChange({
							...input.value,
							dataRetention: {
								...input.value.dataRetention,
								codingAgentFullRecordDays: Math.min(
									365,
									Math.max(1, Number(event.target.value) || 7),
								),
							},
						})
					}
					className="mt-2 block w-32 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
				/>
			</label>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="ghost"
					disabled={busy}
					onClick={() => void loadPreview()}
				>
					{t("settings.general.retention.preview")}
				</Button>
				{preview ? (
					<Button
						type="button"
						disabled={busy}
						onClick={() => void executeCleanup()}
					>
						{t("settings.general.retention.cleanupNow")}
					</Button>
				) : null}
			</div>
			{preview ? (
				<p className="text-xs text-amber-200">
					{t("settings.general.retention.previewSummary", {
						rows: preview.deletable.detailRows,
						bytes: preview.deletable.estimatedDatabaseBytes,
						protected:
							preview.protected.activeRuns +
							preview.protected.reviewPendingRuns +
							preview.protected.closeoutPendingRuns +
							preview.protected.needsHumanRuns,
					})}
				</p>
			) : null}
			{message ? <p className="text-xs text-zinc-300">{message}</p> : null}
		</div>
	);
}
