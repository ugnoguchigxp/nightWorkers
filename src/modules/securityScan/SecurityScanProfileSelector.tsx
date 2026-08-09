import { useTranslation } from "react-i18next";
import type { SecurityScanCapabilities } from "../../../shared/schemas/security-scan.schema";

type SelectableProfile = SecurityScanCapabilities["selectableProfiles"][number];

export function SecurityScanProfileSelector({
	profiles,
	selectedProfileRef,
	onSelect,
}: {
	profiles: SecurityScanCapabilities["selectableProfiles"];
	selectedProfileRef: string | null;
	onSelect: (profile: SelectableProfile) => void;
}) {
	const { t } = useTranslation();
	const selectedProfile = selectedProfileRef
		? profiles.find((profile) => profile.ref === selectedProfileRef)
		: null;
	return (
		<div className="mt-4 text-xs text-zinc-300">
			<label
				htmlFor="security-scan-custom-profile"
				className="mb-1.5 block font-semibold"
			>
				{t("securityScan.customProfile")}
			</label>
			<select
				id="security-scan-custom-profile"
				value={selectedProfileRef ?? ""}
				onChange={(event) => {
					const profile = profiles.find(
						(item) => item.ref === event.target.value,
					);
					if (profile) onSelect(profile);
				}}
				className="h-9 w-full max-w-xl rounded-md border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-100"
			>
				<option value="">{t("securityScan.customNotSelected")}</option>
				{profiles.map((profile) => (
					<option key={profile.ref} value={profile.ref}>
						{profile.name}
					</option>
				))}
			</select>
			{selectedProfile ? (
				<div className="mt-2 max-w-xl rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-[10px] leading-relaxed text-zinc-400">
					<p>{selectedProfile.description}</p>
					{selectedProfile.requirements.length > 0 ? (
						<p className="mt-2 text-zinc-300">
							{t("securityScan.profileRequirements")}:{" "}
							{selectedProfile.requirements.join(" / ")}
						</p>
					) : null}
					{selectedProfile.warnings.length > 0 ? (
						<ul className="mt-2 list-disc space-y-1 pl-4 text-amber-300">
							{selectedProfile.warnings.map((warning) => (
								<li key={warning}>{warning}</li>
							))}
						</ul>
					) : null}
				</div>
			) : null}
		</div>
	);
}
