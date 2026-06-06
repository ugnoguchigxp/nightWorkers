import type { ToolOutputCompressionMetadata } from '../output-compression';

export interface InspectStructureInput {
  filePath: string;
  repoRoot: string;
  includeImports?: boolean;
  previewPrimitives?: boolean;
  maxPaths?: number;
  allowedPaths?: string[];
  externalAllowedPaths?: string[];
  deniedPaths?: string[];
}

export interface SourceImportSummary {
  module: string;
  line: number;
  names: string[];
}

export interface SourceSymbolSummary {
  name: string;
  kind: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature?: string;
}

export interface JsonShapeEntry {
  path: string;
  type: string;
  keys?: number;
  length?: number;
  itemTypes?: string[];
  preview?: string | number | boolean | null;
}

export interface JsonParseDiagnostic {
  message: string;
  line?: number;
  column?: number;
}

export type InspectStructureOutput =
  | {
      kind: 'source';
      filePath: string;
      language: 'typescript' | 'javascript';
      imports?: SourceImportSummary[];
      symbols: SourceSymbolSummary[];
      compression?: ToolOutputCompressionMetadata;
    }
  | {
      kind: 'json';
      filePath: string;
      paths: JsonShapeEntry[];
      parseError?: JsonParseDiagnostic;
      truncated: boolean;
      compression?: ToolOutputCompressionMetadata;
    };
