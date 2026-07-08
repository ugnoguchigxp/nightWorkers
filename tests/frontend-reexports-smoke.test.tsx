import { describe, expect, it } from "vitest";
import { PlanModeQuestionnaire } from "../src/modules/nightworkers/components/ArtifactQuestionnaire";
import { PlanModeWorkspacePanels } from "../src/modules/nightworkers/components/ArtifactWorkspacePanels";
import { PlanModeWorkspaceViewer } from "../src/modules/nightworkers/components/ArtifactWorkspaceViewer";
import { ImplementationQueueScreen } from "../src/modules/nightworkers/components/ImplementationQueueScreen";
import {
	Field,
	NumberField,
	SelectField,
} from "../src/modules/nightworkers/components/SettingsFields";
import {
	emptyHookForm,
	emptyMcpForm,
	settingsSections,
} from "../src/modules/nightworkers/components/SettingsForms";
import { GeneralSettingsPanel } from "../src/modules/nightworkers/components/SettingsGeneralPanel";
import { HooksSettingsPanel } from "../src/modules/nightworkers/components/SettingsHooksPanel";
import { LlmSettingsPanel } from "../src/modules/nightworkers/components/SettingsLlmPanel";
import { McpSettingsPanel } from "../src/modules/nightworkers/components/SettingsMcpPanel";
import { PlanModeSettingsPanel } from "../src/modules/nightworkers/components/SettingsPlanModePanel";
import { SettingsScreen } from "../src/modules/nightworkers/components/SettingsScreen";
import { TestSettingsPanel } from "../src/modules/nightworkers/components/SettingsTestPanel";
import { TodoListPane } from "../src/modules/nightworkers/components/TodoListPane";

describe("Frontend components re-exports smoke tests", () => {
	it("re-exports all expected components and helpers", () => {
		expect(TodoListPane).toBeDefined();
		expect(SettingsScreen).toBeDefined();
		expect(Field).toBeDefined();
		expect(NumberField).toBeDefined();
		expect(SelectField).toBeDefined();
		expect(emptyHookForm).toBeDefined();
		expect(emptyMcpForm).toBeDefined();
		expect(settingsSections).toBeDefined();
		expect(GeneralSettingsPanel).toBeDefined();
		expect(HooksSettingsPanel).toBeDefined();
		expect(LlmSettingsPanel).toBeDefined();
		expect(McpSettingsPanel).toBeDefined();
		expect(PlanModeSettingsPanel).toBeDefined();
		expect(TestSettingsPanel).toBeDefined();
		expect(PlanModeQuestionnaire).toBeDefined();
		expect(PlanModeWorkspacePanels).toBeDefined();
		expect(PlanModeWorkspaceViewer).toBeDefined();
		expect(ImplementationQueueScreen).toBeDefined();
	});
});
