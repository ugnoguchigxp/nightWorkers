export const TEST_MODE_WORKFLOW_ACTION = "plan_and_implement_tests" as const;

export const TEST_MODE_WORKFLOW_STEPS = [
	{
		id: "implementation_start",
		todoTitle: "テスト実装を開始する",
	},
	{
		id: "implementation_complete",
		todoTitle: "テスト実装を完了する",
	},
	{
		id: "evidence_check",
		todoTitle: "証跡テストチェックを行う",
	},
	{
		id: "unit_test",
		todoTitle: "ユニットテストを実行する",
	},
] as const;

export type TestModeWorkflowStepId =
	(typeof TEST_MODE_WORKFLOW_STEPS)[number]["id"];
