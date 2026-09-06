import { useTranslation } from "react-i18next";
import { controlStyle, panelStyle, subtleTextStyle } from "../overviewStyles";

export function OverviewGettingStarted({
	onOpenProviderSettings,
	onRegisterProject,
}: {
	onOpenProviderSettings: () => void;
	onRegisterProject: () => void;
}) {
	const { t } = useTranslation();
	return (
		<section
			aria-labelledby="getting-started-title"
			className="border p-5"
			style={panelStyle}
		>
			<h2 id="getting-started-title" className="text-base font-semibold">
				{t("overview.gettingStarted.title")}
			</h2>
			<ol className="mt-4 grid gap-5 md:grid-cols-3">
				{[
					{ step: "provider", action: onOpenProviderSettings },
					{ step: "project", action: onRegisterProject },
					{ step: "task", action: null },
				].map(({ step, action }, index) => (
					<li key={step} className="space-y-2 text-sm">
						<h3 className="font-semibold">
							{index + 1}. {t(`overview.gettingStarted.${step}.title`)}
						</h3>
						<p style={subtleTextStyle}>
							{t(`overview.gettingStarted.${step}.description`)}
						</p>
						{action ? (
							<button
								type="button"
								onClick={action}
								className="rounded border px-3 py-2 focus-visible:outline-none focus-visible:ring-2"
								style={controlStyle}
							>
								{t(`overview.gettingStarted.${step}.action`)}
							</button>
						) : null}
					</li>
				))}
			</ol>
		</section>
	);
}
