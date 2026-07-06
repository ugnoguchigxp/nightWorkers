import { toObjectArray } from "../previewModel";
import { buildKanbanColumns, kanbanAccentClass } from "./helpers";
import type { SectionRendererInput } from "./types";

export function renderKanbanSection({ props, t }: SectionRendererInput) {
	const columns = buildKanbanColumns(props, t);
	const maxVisibleColumns = toObjectArray(
		props.columns || props.lanes || props.statuses,
	).length
		? 5
		: 3;
	const visibleColumns = columns.slice(0, maxVisibleColumns);
	const rowCount = Math.min(
		Math.max(...visibleColumns.map((column) => column.cards.length), 0),
		5,
	);
	const filters = toObjectArray(
		props.filters || props.views || props.segments,
	).slice(0, 4);
	return (
		<div className="grid gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-card px-3 py-2">
				<div className="min-w-0">
					<div className="text-xs font-semibold text-foreground">
						{String(
							props.boardLabel ||
								props.boardName ||
								props.title ||
								"Kanban board",
						)}
					</div>
					<div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
						{String(
							props.boardDescription ||
								props.description ||
								"Cards move across columns as work progresses.",
						)}
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap gap-1.5 text-[10px] text-muted-foreground">
					{(filters.length > 0
						? filters
						: [{ label: "Search" }, { label: "Filter" }, { label: "Sort" }]
					).map((filter, index) => (
						<span
							className="rounded-full border border-border bg-muted px-2 py-0.5"
							key={String(
								filter.label || filter.title || JSON.stringify(filter),
							)}
						>
							{String(
								filter.label ||
									filter.title ||
									filter.name ||
									`Filter ${index + 1}`,
							)}
						</span>
					))}
				</div>
			</div>
			<div className="overflow-x-auto border border-border bg-card">
				<table className="min-w-[760px] table-fixed border-collapse text-left text-xs">
					<thead>
						<tr className="border-border border-b bg-muted">
							<th className="w-16 border-border border-r px-3 py-2 font-medium text-muted-foreground">
								#
							</th>
							{visibleColumns.map((column, index) => (
								<th
									className="border-border border-r px-3 py-2 font-semibold text-foreground last:border-r-0"
									key={String(
										column.id || column.title || JSON.stringify(column),
									)}
								>
									<div className="flex items-center justify-between gap-2">
										<span className="flex min-w-0 items-center gap-2">
											<span
												className={`h-2 w-2 shrink-0 rounded-full ${kanbanAccentClass(index)}`}
												aria-hidden="true"
											/>
											<span className="truncate">
												{String(
													column.title ||
														column.label ||
														column.name ||
														`Column ${index + 1}`,
												)}
											</span>
										</span>
										<span className="text-[10px] font-medium text-muted-foreground">
											{column.cards.length}
										</span>
									</div>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{Array.from({ length: rowCount }).map((_, rowIndex) => (
							<tr
								className="border-border border-b last:border-b-0"
								key={visibleColumns
									.map((column) =>
										String(
											column.cards[rowIndex]?.title ||
												column.cards[rowIndex]?.label ||
												"",
										),
									)
									.join("|")}
							>
								<td className="border-border border-r bg-muted/50 px-3 py-3 align-top font-medium text-muted-foreground">
									{rowIndex + 1}
								</td>
								{visibleColumns.map((column, columnIndex) => {
									const task = column.cards[rowIndex];
									return (
										<td
											className="h-20 border-border border-r bg-background px-3 py-3 align-top last:border-r-0"
											key={String(column.id || column.title || columnIndex)}
										>
											{task ? (
												<div
													className="grid cursor-grab gap-2 rounded-md border border-border bg-card px-3 py-2 shadow-sm active:cursor-grabbing"
													draggable
												>
													<div className="flex items-start justify-between gap-2">
														<span className="min-w-0 font-medium text-foreground">
															{String(
																task.title || task.label || task.name || "Task",
															)}
														</span>
														{task.priority || task.badge || task.tag ? (
															<span className="shrink-0 text-[10px] font-medium text-muted-foreground">
																{String(
																	task.priority || task.badge || task.tag,
																)}
															</span>
														) : null}
													</div>
													<div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
														<span>
															{String(
																task.assignee || task.owner || "Unassigned",
															)}
														</span>
														{task.dueDate || task.updatedAt ? (
															<span>
																{String(task.dueDate || task.updatedAt)}
															</span>
														) : null}
													</div>
												</div>
											) : (
												<span className="text-muted-foreground/50">-</span>
											)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
