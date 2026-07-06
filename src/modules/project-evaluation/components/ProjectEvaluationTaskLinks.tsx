import { ExternalLink } from "lucide-react";
import type { ProjectEvaluationTaskLink } from "../model/projectEvaluationTypes";

export function ProjectEvaluationTaskLinks({
	links,
}: {
	links: ProjectEvaluationTaskLink[];
}) {
	if (links.length === 0) return null;
	return (
		<section className="rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] p-3 shadow-sm">
			<div className="font-semibold text-[var(--nw-muted-text)] text-xs uppercase">
				Created Tasks
			</div>
			<div className="mt-2 grid gap-2">
				{links.map((link) => (
					<a
						className="flex items-center justify-between rounded-md border border-[var(--nw-border)] bg-[var(--nw-surface)] px-3 py-2 text-[var(--nw-text)] text-sm hover:border-[var(--nw-primary)]"
						href={`/tasks/${link.taskId}`}
						key={link.id}
					>
						<span>{link.task?.title ?? link.taskId}</span>
						<ExternalLink className="h-4 w-4 text-[var(--nw-subtle-text)]" />
					</a>
				))}
			</div>
		</section>
	);
}
