import { CheckCircle2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readJsonResponse } from "../../lib/api-error";
import {
	fetchBlueprintAdoption,
	fetchBlueprintDesignTokenAdoption,
	saveBlueprintAdoption,
	saveBlueprintDesignTokenAdoption,
} from "../blueprint/blueprintCommands";
import { PreviewActionButton } from "./BlueprintPreviewPrimitives";

export function useBlueprintAdoption({
	sessionId,
	messageId,
	kind,
}: {
	sessionId?: string | null;
	messageId?: string | null;
	kind: "blueprint" | "designTokens";
}) {
	const [adopted, setAdopted] = useState(false);
	const [saving, setSaving] = useState(false);
	const enabled = Boolean(sessionId && messageId);

	useEffect(() => {
		setAdopted(false);
		if (!sessionId || !messageId) return;
		const controller = new AbortController();
		const request =
			kind === "blueprint"
				? fetchBlueprintAdoption(sessionId, messageId, {
						signal: controller.signal,
					})
				: fetchBlueprintDesignTokenAdoption(sessionId, messageId, {
						signal: controller.signal,
					});
		request
			.then((res) => readJsonResponse<{ adopted?: boolean }>(res))
			.then((data) => {
				if (controller.signal.aborted || !data) return;
				setAdopted(Boolean(data.adopted));
			})
			.catch((error) => {
				if (error?.name !== "AbortError") {
					console.warn(
						`Failed to load Blueprint adoption state for ${kind}`,
						error,
					);
				}
			});
		return () => controller.abort();
	}, [kind, messageId, sessionId]);

	const toggle = useCallback(() => {
		if (!sessionId || !messageId || saving) return;
		const next = !adopted;
		setAdopted(next);
		setSaving(true);
		const request =
			kind === "blueprint"
				? saveBlueprintAdoption(sessionId, { messageId, adopted: next })
				: saveBlueprintDesignTokenAdoption(sessionId, {
						messageId,
						adopted: next,
					});
		request
			.then((res) => readJsonResponse<{ adopted?: boolean }>(res))
			.then((data: { adopted?: boolean }) => {
				setAdopted(Boolean(data.adopted));
			})
			.catch((error) => {
				setAdopted(!next);
				console.warn(
					`Failed to save Blueprint adoption state for ${kind}`,
					error,
				);
			})
			.finally(() => setSaving(false));
	}, [adopted, kind, messageId, saving, sessionId]);

	return { adopted, enabled, saving, toggle };
}

export function AdoptionToggle({
	label,
	adopted,
	disabled,
	onToggle,
}: {
	label: string;
	adopted: boolean;
	disabled?: boolean;
	onToggle: () => void;
}) {
	const { t } = useTranslation();
	const Icon = adopted ? CheckCircle2 : XCircle;
	return (
		<PreviewActionButton
			aria-pressed={adopted}
			tone={adopted ? "primary" : "secondary"}
			disabled={disabled}
			onClick={onToggle}
		>
			<Icon className="h-3.5 w-3.5" />
			{label}:{" "}
			{adopted
				? t("blueprint.preview.adopted")
				: t("blueprint.preview.notAdopted")}
		</PreviewActionButton>
	);
}
