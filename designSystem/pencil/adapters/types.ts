export interface Theme {
  [key: string]: string;
}

export type ThemeAxesValues = {
  [axisName: string]: string[];
};

export type VariableValue =
  | string
  | number
  | boolean
  | { value: string | number | boolean; theme?: Theme }[];

export interface NormalizedVariables {
  [varName: string]: {
    type: 'color' | 'number' | 'boolean' | 'string';
    value: VariableValue;
  };
}

export interface PenFileAdapter {
  readonly supportedVersion: string;

  /** Update variables and themes in the original pen document */
  updateVariablesAndThemes(raw: any, variables: NormalizedVariables, themes: ThemeAxesValues): any;
}
