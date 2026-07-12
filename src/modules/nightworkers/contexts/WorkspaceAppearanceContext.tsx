import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import {
	type BlueprintPreviewDesignSettings,
	createBlueprintPreviewDesignSettings,
} from "../../blueprint-preview";

const STORAGE_KEY = "nightworkers.workspaceAppearance.v1";

type WorkspaceAppearanceState = {
	settings: BlueprintPreviewDesignSettings;
	savedSettings: BlueprintPreviewDesignSettings;
	attributes: WorkspaceAppearanceAttributes;
};

type WorkspaceAppearanceActions = {
	applyAppearanceSettings: (settings: BlueprintPreviewDesignSettings) => void;
	saveAppearanceSettings: (settings: BlueprintPreviewDesignSettings) => void;
	resetAppearanceSettings: () => void;
};

export type WorkspaceAppearanceAttributes = {
	"data-theme": BlueprintPreviewDesignSettings["theme"];
	"data-density": BlueprintPreviewDesignSettings["density"];
	"data-shape": BlueprintPreviewDesignSettings["shape"];
	"data-shadow": BlueprintPreviewDesignSettings["shadow"];
	"data-shadow-direction": BlueprintPreviewDesignSettings["shadowDirection"];
	"data-font": BlueprintPreviewDesignSettings["font"];
	"data-contrast": BlueprintPreviewDesignSettings["contrast"];
	"data-motion": BlueprintPreviewDesignSettings["motion"];
	"data-button-variant": BlueprintPreviewDesignSettings["componentVariants"]["button"];
	"data-card-variant": BlueprintPreviewDesignSettings["componentVariants"]["card"];
	"data-table-variant": BlueprintPreviewDesignSettings["componentVariants"]["table"];
	"data-input-variant": BlueprintPreviewDesignSettings["componentVariants"]["input"];
};

const WorkspaceAppearanceStateContext =
	createContext<WorkspaceAppearanceState | null>(null);
const WorkspaceAppearanceActionsContext =
	createContext<WorkspaceAppearanceActions | null>(null);

export function createWorkspaceAppearanceAttributes(
	settings: BlueprintPreviewDesignSettings,
): WorkspaceAppearanceAttributes {
	return {
		"data-theme": settings.theme,
		"data-density": settings.density,
		"data-shape": settings.shape,
		"data-shadow": settings.shadow,
		"data-shadow-direction": settings.shadowDirection,
		"data-font": settings.font,
		"data-contrast": settings.contrast,
		"data-motion": settings.motion,
		"data-button-variant": settings.componentVariants.button,
		"data-card-variant": settings.componentVariants.card,
		"data-table-variant": settings.componentVariants.table,
		"data-input-variant": settings.componentVariants.input,
	};
}

function readStoredAppearanceSettings(): BlueprintPreviewDesignSettings {
	if (typeof window === "undefined")
		return createBlueprintPreviewDesignSettings(undefined);

	try {
		return createBlueprintPreviewDesignSettings(
			JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null"),
		);
	} catch {
		return createBlueprintPreviewDesignSettings(undefined);
	}
}

function storeAppearanceSettings(settings: BlueprintPreviewDesignSettings) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function clearStoredAppearanceSettings() {
	if (typeof window === "undefined") return;
	window.localStorage.removeItem(STORAGE_KEY);
}

export function WorkspaceAppearanceProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [savedSettings, setSavedSettings] =
		useState<BlueprintPreviewDesignSettings>(readStoredAppearanceSettings);
	const [settings, setSettings] =
		useState<BlueprintPreviewDesignSettings>(savedSettings);

	const applyAppearanceSettings = useCallback(
		(nextSettings: BlueprintPreviewDesignSettings) => {
			const normalized = createBlueprintPreviewDesignSettings(nextSettings);
			setSettings(normalized);
		},
		[],
	);

	const saveAppearanceSettings = useCallback(
		(nextSettings: BlueprintPreviewDesignSettings) => {
			const normalized = createBlueprintPreviewDesignSettings(nextSettings);
			setSettings(normalized);
			setSavedSettings(normalized);
			storeAppearanceSettings(normalized);
		},
		[],
	);

	const resetAppearanceSettings = useCallback(() => {
		const defaults = createBlueprintPreviewDesignSettings(undefined);
		setSettings(defaults);
		setSavedSettings(defaults);
		clearStoredAppearanceSettings();
	}, []);

	const attributes = useMemo(
		() => createWorkspaceAppearanceAttributes(settings),
		[settings],
	);
	const state = useMemo<WorkspaceAppearanceState>(
		() => ({ settings, savedSettings, attributes }),
		[attributes, savedSettings, settings],
	);
	const actions = useMemo<WorkspaceAppearanceActions>(
		() => ({
			applyAppearanceSettings,
			saveAppearanceSettings,
			resetAppearanceSettings,
		}),
		[applyAppearanceSettings, resetAppearanceSettings, saveAppearanceSettings],
	);

	return (
		<WorkspaceAppearanceStateContext.Provider value={state}>
			<WorkspaceAppearanceActionsContext.Provider value={actions}>
				{children}
			</WorkspaceAppearanceActionsContext.Provider>
		</WorkspaceAppearanceStateContext.Provider>
	);
}

export function useWorkspaceAppearanceState() {
	const state = useContext(WorkspaceAppearanceStateContext);
	if (!state) {
		throw new Error(
			"useWorkspaceAppearanceState must be used within WorkspaceAppearanceProvider",
		);
	}
	return state;
}

export function useWorkspaceAppearanceActions() {
	const actions = useContext(WorkspaceAppearanceActionsContext);
	if (!actions) {
		throw new Error(
			"useWorkspaceAppearanceActions must be used within WorkspaceAppearanceProvider",
		);
	}
	return actions;
}
