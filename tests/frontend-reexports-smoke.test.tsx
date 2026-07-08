import { describe, expect, it } from "vitest";
import { QuestionnaireForm } from "../src/modules/nightworkers/components/ArtifactQuestionnaire";
import { WorkspaceBlueprintPreview } from "../src/modules/nightworkers/components/ArtifactWorkspacePanels";
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
import { SettingsHooksPanel } from "../src/modules/nightworkers/components/SettingsHooksPanel";
import { SettingsLlmPanel } from "../src/modules/nightworkers/components/SettingsLlmPanel";
import { SettingsMcpPanel } from "../src/modules/nightworkers/components/SettingsMcpPanel";
import { SettingsPlanModePanel } from "../src/modules/nightworkers/components/SettingsPlanModePanel";
import { SettingsScreen } from "../src/modules/nightworkers/components/SettingsScreen";
import { SettingsTestPanel } from "../src/modules/nightworkers/components/SettingsTestPanel";
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
		expect(SettingsHooksPanel).toBeDefined();
		expect(SettingsLlmPanel).toBeDefined();
		expect(SettingsMcpPanel).toBeDefined();
		expect(SettingsPlanModePanel).toBeDefined();
		expect(SettingsTestPanel).toBeDefined();
		expect(QuestionnaireForm).toBeDefined();
		expect(WorkspaceBlueprintPreview).toBeDefined();
		expect(PlanModeWorkspaceViewer).toBeDefined();
		expect(ImplementationQueueScreen).toBeDefined();
	});
});
