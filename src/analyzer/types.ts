/** Supported languages for analysis */
export type Language = 'typescript' | 'go' | 'python';

/** The kind of callable unit */
export type FunctionKind = 'function' | 'method' | 'constructor' | 'arrow' | 'closure' | 'lambda';

/** Visibility/access level of a function */
export type Visibility = 'exported' | 'public' | 'private' | 'internal' | 'module';

/** Status of a node in the call graph */
export type NodeStatus = 'live' | 'dead' | 'entry';

/** Color derived from node status */
export type NodeColor = 'green' | 'red' | 'yellow' | 'orange' | 'blue';

/** The nature of a call edge */
export type EdgeKind = 'direct' | 'method' | 'constructor' | 'callback' | 'dynamic';

/** A function parameter */
export interface Parameter {
  name: string;
  type: string | null;
  isUsed: boolean;
  position: number;
}

/** A function/method node in the call graph */
export interface GraphNode {
  id: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: Language;
  kind: FunctionKind;
  visibility: Visibility;
  isEntryPoint: boolean;
  parameters: Parameter[];
  unusedParameters: string[];
  packageOrModule: string;
  linesOfCode: number;
  status: NodeStatus;
  color: NodeColor;
  /** Decorator/annotation names applied to this function (e.g., ["app.route", "login_required"]) */
  decorators?: string[];
}

/** Location of a call site */
export interface CallSite {
  filePath: string;
  line: number;
  column: number;
}

/** A directed edge representing a function call */
export interface GraphEdge {
  source: string;
  target: string;
  callSite: CallSite;
  kind: EdgeKind;
  isResolved: boolean;
}

/** The virtual entry node */
export interface EntryNode {
  id: string;
  name: string;
  targets: string[];
}

/** A cluster of nodes belonging to the same package/module */
export interface Cluster {
  id: string;
  label: string;
  nodeIds: string[];
  parent: string | null;
}

/** Dead code statistics */
export interface DeadCodeStats {
  count: number;
  percentage: number;
  byPackage: Record<string, number>;
}

/** Unused parameter statistics */
export interface UnusedParamStats {
  count: number;
  percentage: number;
  byPackage: Record<string, number>;
}

/** Entry point statistics */
export interface EntryPointStats {
  count: number;
  functions: string[];
}

/** Large function info */
export interface LargeFunctionInfo {
  id: string;
  linesOfCode: number;
}

/** Summary statistics */
export interface GraphStats {
  deadFunctions: DeadCodeStats;
  unusedParameters: UnusedParamStats;
  entryPoints: EntryPointStats;
  largestFunctions: LargeFunctionInfo[];
}

/** Analysis metadata */
export interface AnalysisMetadata {
  version: string;
  generatedAt: string;
  language: Language;
  projectRoot: string;
  analysisTimeMs: number;
  totalFiles: number;
  totalFunctions: number;
  totalEdges: number;
  totalDeadFunctions: number;
  totalUnusedParameters: number;
  config: ResolvedConfig;
}

/** The complete output graph */
export interface CodeGraph {
  metadata: AnalysisMetadata;
  nodes: GraphNode[];
  edges: GraphEdge[];
  entryNode: EntryNode;
  clusters: Cluster[];
  stats: GraphStats;
}

/** Entry point config types */
export type EntryPointConfig =
  | { type: 'file'; pattern: string }
  | { type: 'function'; name: string }
  | { type: 'decorator'; name: string }
  | { type: 'export'; pattern: string };

/** TypeScript-specific options */
export interface TypeScriptOptions {
  tsconfig?: string;
}

/** Go-specific options */
export interface GoOptions {
  module?: string;
  buildTags?: string[];
}

/** Python-specific options */
export interface PythonOptions {
  pythonVersion?: string;
  venvPath?: string;
  sourceRoots?: string[];
}

/** Configuration file schema */
export interface CodeGraphConfig {
  language: Language;
  include: string[];
  exclude: string[];
  entryPoints: EntryPointConfig[];
  output: string;
  typescript?: TypeScriptOptions;
  go?: GoOptions;
  python?: PythonOptions;
}

/** Resolved config (with defaults applied) */
export interface ResolvedConfig extends CodeGraphConfig {
  projectRoot: string;
}

/** Result from a language-specific analyzer */
export interface AnalyzerResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  files: number;
}
