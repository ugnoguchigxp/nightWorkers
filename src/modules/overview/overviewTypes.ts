export type OverviewScope =
	| { kind: "all" }
	| { kind: "project"; projectId: string };
