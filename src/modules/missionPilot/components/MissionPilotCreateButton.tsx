import { Loader2, PlaneTakeoff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconActionButton } from "../../nightworkers/components/project-detail/ProjectDetailCommon";
export function MissionPilotCreateButton({
	disabled,
	busy,
	onClick,
}: {
	disabled: boolean;
	busy: boolean;
	onClick: () => void;
}) {
	const { t } = useTranslation();
	return (
		<IconActionButton
			onClick={onClick}
			disabled={disabled || busy}
			label={t(
				busy
					? "missionPilot.startingFromCandidate"
					: "missionPilot.startFromCandidate",
			)}
		>
			{busy ? (
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
			) : (
				<PlaneTakeoff className="h-3.5 w-3.5" />
			)}
		</IconActionButton>
	);
}
