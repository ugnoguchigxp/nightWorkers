import type { TFunction } from "i18next";
import type { ReactNode } from "react";

export type SectionRendererInput = {
	componentName: string;
	props: Record<string, unknown>;
	t: TFunction;
};

export type SectionRenderer = (input: SectionRendererInput) => ReactNode;
