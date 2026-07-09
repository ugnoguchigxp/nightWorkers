import {
	AlertTriangle,
	Check,
	Clock3,
	LoaderCircle,
	Pause,
	type Square,
	X,
} from "lucide-react";

export type TodoRailListStatus =
	| "pending"
	| "running"
	| "passed"
	| "failed"
	| "skipped"
	| "needs_human";

export type TodoRailListItem = {
	id: string;
	seq: number;
	title: string;
	status: TodoRailListStatus;
	instruction?: string | null;
	activeLabel?: string | null;
	statusLabel?: string | null;
};

type TodoRailListProps = {
	items: TodoRailListItem[];
	className?: string;
	variant?: "pane" | "embedded";
};

export function TodoRailList({
	items,
	className = "",
	variant = "pane",
}: TodoRailListProps) {
	const rootClassName = [
		"nightworkers-todo-rail-list",
		variant === "embedded" ? "nightworkers-todo-rail-list-embedded" : "",
		className,
	]
		.filter(Boolean)
		.join(" ");
	return (
		<ol className={rootClassName}>
			{items.map((item) => {
				const style = todoStatusStyle(item.status);
				const Icon = style.icon;
				return (
					<li
						key={item.id}
						className={`nightworkers-todo-item ${style.itemClass}`}
					>
						<div className="nightworkers-todo-timeline" aria-hidden="true">
							<span className={`nightworkers-todo-node ${style.nodeClass}`}>
								<Icon
									className={`h-4 w-4 ${
										item.status === "running" ? "animate-spin" : ""
									}`}
								/>
							</span>
						</div>
						<div className="nightworkers-todo-row min-w-0">
							<span className="nightworkers-todo-seq">
								{formatTodoSeq(item.seq)}
							</span>
							<div className="min-w-0 flex-1">
								<div className="flex min-w-0 items-baseline gap-2">
									<span className="nightworkers-todo-pane-title min-w-0 truncate text-sm font-medium leading-5">
										{item.title}
									</span>
									{item.activeLabel ? (
										<span className="nightworkers-todo-active-label shrink-0 text-[10px] font-medium uppercase">
											{item.activeLabel}
										</span>
									) : item.statusLabel ? (
										<span className="nightworkers-todo-status-label shrink-0 text-[10px] font-medium">
											{item.statusLabel}
										</span>
									) : null}
								</div>
								{item.instruction ? (
									<p className="nightworkers-todo-instruction mt-1 truncate text-xs leading-5">
										{item.instruction}
									</p>
								) : null}
							</div>
						</div>
					</li>
				);
			})}
		</ol>
	);
}

function todoStatusStyle(status: TodoRailListStatus): {
	icon: typeof Square;
	itemClass: string;
	nodeClass: string;
} {
	switch (status) {
		case "passed":
			return {
				icon: Check,
				itemClass: "nightworkers-todo-item-passed",
				nodeClass: "nightworkers-todo-node-success",
			};
		case "running":
			return {
				icon: LoaderCircle,
				itemClass: "nightworkers-todo-item-running",
				nodeClass: "nightworkers-todo-node-running",
			};
		case "failed":
			return {
				icon: X,
				itemClass: "nightworkers-todo-item-failed",
				nodeClass: "nightworkers-todo-node-danger",
			};
		case "skipped":
			return {
				icon: Pause,
				itemClass: "nightworkers-todo-item-muted",
				nodeClass: "nightworkers-todo-node-muted",
			};
		case "needs_human":
			return {
				icon: AlertTriangle,
				itemClass: "nightworkers-todo-item-warning",
				nodeClass: "nightworkers-todo-node-warning",
			};
		case "pending":
			return {
				icon: Clock3,
				itemClass: "nightworkers-todo-item-pending",
				nodeClass: "nightworkers-todo-node-pending",
			};
	}
}

function formatTodoSeq(seq: number) {
	return String(seq).padStart(2, "0");
}
