import { Code2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProjectStackProfile } from "../../../../shared/schemas/tech-stack.schema";

export function StackSummaryBadge({
	stackProfile,
}: {
	stackProfile: ProjectStackProfile;
}) {
	const { t } = useTranslation();
	const summary = stackProfile.summary || t("techStack.profile.unknown");
	return (
		<div
			className="flex min-h-8 max-w-full items-center gap-2 border px-3 text-xs font-semibold"
			style={{
				background: "color-mix(in srgb, var(--nw-primary) 9%, var(--nw-panel))",
				borderColor:
					"color-mix(in srgb, var(--nw-primary) 35%, var(--nw-border))",
				borderRadius: "var(--nw-control-radius)",
				color: "var(--nw-primary)",
			}}
			title={summary}
		>
			<Code2 className="h-3.5 w-3.5 shrink-0" />
			<span className="truncate">{summary}</span>
		</div>
	);
}
