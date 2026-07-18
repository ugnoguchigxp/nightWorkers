import type { WorkerToolName } from "./types";

export type ToolManifestEntry = {
	name: WorkerToolName;
	mutatesWorkspace: boolean;
	requiresReadBeforeEdit: boolean;
	pathArgs: string[];
	commandArg?: string;
	cwdArg?: string;
};

export const TOOL_MANIFEST: Record<WorkerToolName, ToolManifestEntry> = {
	list_dir: {
		name: "list_dir",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: ["relativePath"],
	},
	find_file: {
		name: "find_file",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: ["relativePath"],
	},
	read_file: {
		name: "read_file",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: ["filePath"],
	},
	read_current_specification: {
		name: "read_current_specification",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
	},
	inspect_structure: {
		name: "inspect_structure",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: ["filePath"],
	},
	search_files: {
		name: "search_files",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
	},
	search_web: {
		name: "search_web",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
	},
	fetch_content: {
		name: "fetch_content",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
	},
	import_project: {
		name: "import_project",
		mutatesWorkspace: true,
		requiresReadBeforeEdit: false,
		pathArgs: ["targetPath"],
	},
	clone_git_repo: {
		name: "clone_git_repo",
		mutatesWorkspace: true,
		requiresReadBeforeEdit: false,
		pathArgs: ["targetPath"],
	},
	copy_directory: {
		name: "copy_directory",
		mutatesWorkspace: true,
		requiresReadBeforeEdit: false,
		pathArgs: ["sourcePath", "targetPath"],
	},
	materialize_template: {
		name: "materialize_template",
		mutatesWorkspace: true,
		requiresReadBeforeEdit: false,
		pathArgs: ["targetPath"],
	},
	apply_patch: {
		name: "apply_patch",
		mutatesWorkspace: true,
		requiresReadBeforeEdit: true,
		pathArgs: [],
	},
	replace_content: {
		name: "replace_content",
		mutatesWorkspace: true,
		requiresReadBeforeEdit: true,
		pathArgs: ["filePath"],
	},
	run_command: {
		name: "run_command",
		mutatesWorkspace: true,
		requiresReadBeforeEdit: false,
		pathArgs: [],
		commandArg: "command",
		cwdArg: "cwd",
	},
	run_background_command: {
		name: "run_background_command",
		mutatesWorkspace: true,
		requiresReadBeforeEdit: false,
		pathArgs: [],
		commandArg: "command",
		cwdArg: "cwd",
	},
	run_check: {
		name: "run_check",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
		commandArg: "command",
		cwdArg: "cwd",
	},
	run_verification: {
		name: "run_verification",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
		commandArg: "command",
		cwdArg: "cwd",
	},
	completion_check: {
		name: "completion_check",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
	},
	collect_test_inventory: {
		name: "collect_test_inventory",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
		cwdArg: "cwd",
	},
	record_test_condition_mapping: {
		name: "record_test_condition_mapping",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
	},
	project_exploration_catalog: {
		name: "project_exploration_catalog",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
	},
	mcp_call_tool: {
		name: "mcp_call_tool",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
	},
	git_status: {
		name: "git_status",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
	},
	git_diff: {
		name: "git_diff",
		mutatesWorkspace: false,
		requiresReadBeforeEdit: false,
		pathArgs: [],
	},
};
