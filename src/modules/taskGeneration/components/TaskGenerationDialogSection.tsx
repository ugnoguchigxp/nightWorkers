import { mutedTextStyle } from "../../nightworkers/components/project-detail/styles";

export function DrawerSection({
	title,
	body,
}: {
	title: string;
	body: string;
}) {
	return (
		<section className="mt-4">
			<div className="text-xs font-bold">{title}</div>
			<p className="mt-1 whitespace-pre-wrap text-xs" style={mutedTextStyle}>
				{body}
			</p>
		</section>
	);
}
