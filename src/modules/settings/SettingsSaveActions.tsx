import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";

export type SettingsSaveStatus = "idle" | "success" | "error";

export function SettingsSaveActions({
	onSave,
	isSaving = false,
	saveStatus = "idle",
	saveMessage = "",
	disabled = false,
	secondaryAction,
}: {
	onSave: () => void;
	isSaving?: boolean;
	saveStatus?: SettingsSaveStatus;
	saveMessage?: string;
	disabled?: boolean;
	secondaryAction?: ReactNode;
}) {
	const { t } = useTranslation();
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			{saveMessage ? (
				<div
					role={saveStatus === "error" ? "alert" : "status"}
					className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
						saveStatus === "success"
							? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
							: "border-rose-500/40 bg-rose-500/10 text-rose-200"
					}`}
				>
					{saveStatus === "success" ? (
						<CheckCircle2 className="h-4 w-4 shrink-0" />
					) : (
						<XCircle className="h-4 w-4 shrink-0" />
					)}
					<span>{saveMessage}</span>
				</div>
			) : (
				<span />
			)}
			<div className="flex flex-wrap items-center gap-2">
				{secondaryAction}
				<Button
					type="button"
					onClick={onSave}
					disabled={disabled || isSaving}
					variant={saveStatus === "success" ? "success" : "default"}
					className="h-9 gap-2 px-5 text-xs"
				>
					{isSaving ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
					{saveStatus === "success" && !isSaving ? (
						<CheckCircle2 className="h-3.5 w-3.5" />
					) : null}
					{t("settings.saveAll")}
				</Button>
			</div>
		</div>
	);
}
