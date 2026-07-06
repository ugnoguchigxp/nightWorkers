import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";
import {
	compareProjectQueuePriority,
	getProjectQueuePriorityLabel,
	getProjectQueueStatusLabel,
	projectQueueTimestamp,
	sortProjectQueueTasksForTable,
} from "./projectQueueModel";
import type { ProjectQueueTask } from "./projectQueueTypes";
import { getRelativeTimestamp } from "./queueTime";

type ProjectQueueTableProps = {
	tasks: ProjectQueueTask[];
	onOpenSession: (sessionId: string) => void;
};

export function ProjectQueueTable({
	tasks,
	onOpenSession,
}: ProjectQueueTableProps) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const data = useMemo(
		() => (sorting.length > 0 ? tasks : sortProjectQueueTasksForTable(tasks)),
		[sorting.length, tasks],
	);
	const columns = useMemo<ColumnDef<ProjectQueueTask>[]>(
		() => [
			{
				id: "status",
				header: "Status",
				accessorFn: (task) => getProjectQueueStatusLabel(task.status),
				cell: ({ row }) => <ProjectQueueStatusCell task={row.original} />,
			},
			{
				id: "queuePriority",
				header: "Queue Priority",
				accessorFn: (task) => task.queuePosition ?? null,
				cell: ({ row }) => <ProjectQueuePriorityCell task={row.original} />,
				sortingFn: (a, b) =>
					compareProjectQueuePriority(a.original, b.original),
			},
			{
				id: "task",
				header: "Task",
				accessorKey: "title",
				cell: ({ row }) => (
					<button
						className="min-w-64 text-left"
						onClick={() => onOpenSession(row.original.sessionId)}
						type="button"
					>
						<div className="font-medium text-slate-100">
							{row.original.title}
						</div>
						<div className="mt-1 line-clamp-1 text-slate-500 text-xs">
							{row.original.statusReason || row.original.id}
						</div>
					</button>
				),
			},
			{
				id: "phase",
				header: "Phase",
				accessorKey: "phase",
				cell: ({ row }) => (
					<span className="text-slate-300">{row.original.phase}</span>
				),
			},
			{
				id: "updated",
				header: "Updated",
				accessorFn: (task) => projectQueueTimestamp(task.updatedAt),
				cell: ({ row }) => (
					<span className="text-slate-400">
						{getRelativeTimestamp(row.original.updatedAt)}
					</span>
				),
			},
		],
		[onOpenSession],
	);
	const table = useReactTable({
		columns,
		data,
		enableSortingRemoval: false,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		onSortingChange: setSorting,
		sortDescFirst: false,
		state: { sorting },
	});

	return (
		<div className="min-h-[620px] min-w-[980px] p-4" data-project-queue-table>
			<div className="overflow-hidden rounded-md border border-slate-800 bg-slate-950/30">
				<table className="w-full border-collapse text-left text-sm">
					<thead className="bg-slate-950/80 text-slate-400 text-xs uppercase">
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<th
										className="border-slate-800 border-b px-3 py-2"
										key={header.id}
									>
										{header.isPlaceholder ? null : (
											<button
												className="flex w-full items-center justify-between gap-2 text-left font-semibold transition hover:text-cyan-100"
												data-table-sort={header.column.id}
												onClick={header.column.getToggleSortingHandler()}
												type="button"
											>
												<span>
													{flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
												</span>
												<span className="text-[10px] text-slate-500">
													{header.column.getIsSorted() === "asc"
														? "ASC"
														: header.column.getIsSorted() === "desc"
															? "DESC"
															: ""}
												</span>
											</button>
										)}
									</th>
								))}
							</tr>
						))}
					</thead>
					<tbody>
						{table.getRowModel().rows.map((row) => (
							<tr
								className="border-slate-800 border-b last:border-b-0 hover:bg-slate-900/55"
								data-table-status={row.original.status}
								key={row.original.id}
							>
								{row.getVisibleCells().map((cell) => (
									<td className="px-3 py-3 align-top" key={cell.id}>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function ProjectQueueStatusCell({ task }: { task: ProjectQueueTask }) {
	const toneClass = {
		cancelled: "border-amber-400/35 bg-amber-950/45 text-amber-100",
		completed: "border-slate-700 bg-slate-950/60 text-slate-300",
		failed: "border-amber-400/35 bg-amber-950/45 text-amber-100",
		needs_human: "border-amber-400/35 bg-amber-950/45 text-amber-100",
		plan_mode: "border-violet-400/35 bg-violet-950/35 text-violet-100",
		queued: "border-emerald-400/35 bg-emerald-950/40 text-emerald-100",
		ready_for_queue: "border-emerald-400/35 bg-emerald-950/40 text-emerald-100",
		review_required: "border-amber-400/35 bg-amber-950/45 text-amber-100",
		running: "border-cyan-400/35 bg-cyan-950/45 text-cyan-100",
		unclassified: "border-slate-700 bg-slate-950/60 text-slate-300",
	}[task.status];
	return (
		<div className="flex flex-col gap-1">
			<span
				className={`w-fit rounded border px-2 py-1 font-medium ${toneClass}`}
			>
				{getProjectQueueStatusLabel(task.status)}
			</span>
			{task.executionType && task.executionType !== "normal" ? (
				<span className="w-fit rounded border border-amber-500/35 bg-amber-950/35 px-2 py-0.5 text-amber-100 text-xs">
					{task.executionType}
				</span>
			) : null}
			<span className="text-slate-500 text-xs">
				{task.activeRunId || task.queueEntryId || ""}
			</span>
		</div>
	);
}

function ProjectQueuePriorityCell({ task }: { task: ProjectQueueTask }) {
	const label = getProjectQueuePriorityLabel(task);
	if (!label) return null;
	return (
		<span className="inline-flex min-w-14 justify-center rounded border border-slate-700 bg-slate-950/65 px-2 py-1 font-semibold text-slate-200">
			{label}
		</span>
	);
}
