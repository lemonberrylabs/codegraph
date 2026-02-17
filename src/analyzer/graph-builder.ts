import type {
  CodeGraph,
  ResolvedConfig,
  GraphNode,
  GraphEdge,
  Cluster,
  GraphStats,
  AnalysisMetadata,
} from './types.js';
import { matchEntryPoints, propagateEntryPoints, createEntryNode } from './entry-points.js';
import { BaseAnalyzer } from './base-analyzer.js';

/** Create the appropriate analyzer for the configured language */
async function createAnalyzer(config: ResolvedConfig): Promise<BaseAnalyzer> {
  switch (config.language) {
    case 'typescript': {
      const { TypeScriptAnalyzer } = await import('./typescript/ts-analyzer.js');
      return new TypeScriptAnalyzer(config);
    }
    case 'go': {
      const { GoAnalyzer } = await import('./go/go-analyzer.js');
      return new GoAnalyzer(config);
    }
    case 'python': {
      const { PythonAnalyzer } = await import('./python/py-analyzer.js');
      return new PythonAnalyzer(config);
    }
    default:
      throw new Error(`Unsupported language: ${config.language}`);
  }
}

/** Run the full analysis pipeline */
export async function runAnalysis(config: ResolvedConfig): Promise<CodeGraph> {
  const startTime = Date.now();

  // 1. Create analyzer and run analysis
  const analyzer = await createAnalyzer(config);
  const result = await analyzer.analyze();

  // 2. Match entry points
  const entryPointIds = matchEntryPoints(result.nodes, config.entryPoints);

  // 3. Propagate entry points (mark live/dead)
  propagateEntryPoints(result.nodes, result.edges, entryPointIds);

  // 4. Build clusters
  const clusters = buildClusters(result.nodes);

  // 5. Create entry node
  const entryNode = createEntryNode(entryPointIds);

  // 6. Compute stats
  const stats = computeStats(result.nodes, entryPointIds);

  // 7. Build metadata
  const analysisTimeMs = Date.now() - startTime;
  const deadCount = result.nodes.filter(n => n.status === 'dead').length;
  const unusedParamCount = result.nodes.filter(n => n.unusedParameters.length > 0).length;

  const metadata: AnalysisMetadata = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    language: config.language,
    projectRoot: config.projectRoot,
    analysisTimeMs,
    totalFiles: result.files,
    totalFunctions: result.nodes.length,
    totalEdges: result.edges.length,
    totalDeadFunctions: deadCount,
    totalUnusedParameters: unusedParamCount,
    config,
  };

  return {
    metadata,
    nodes: result.nodes,
    edges: result.edges,
    entryNode,
    clusters,
    stats,
  };
}

/** Build clusters from node package/module assignments */
function buildClusters(nodes: GraphNode[]): Cluster[] {
  const clusterMap = new Map<string, string[]>();

  for (const node of nodes) {
    const pkg = node.packageOrModule;
    const ids = clusterMap.get(pkg) || [];
    ids.push(node.id);
    clusterMap.set(pkg, ids);
  }

  return Array.from(clusterMap.entries()).map(([id, nodeIds]) => {
    const parts = id.split('/');
    const label = parts[parts.length - 1] || id;
    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : null;

    return { id, label, nodeIds, parent };
  });
}

/** Compute summary statistics */
function computeStats(nodes: GraphNode[], entryPointIds: string[]): GraphStats {
  const deadNodes = nodes.filter(n => n.status === 'dead');
  const unusedParamNodes = nodes.filter(n => n.unusedParameters.length > 0);
  const total = nodes.length;

  // Dead code by package
  const deadByPackage: Record<string, number> = {};
  for (const node of deadNodes) {
    deadByPackage[node.packageOrModule] = (deadByPackage[node.packageOrModule] || 0) + 1;
  }

  // Unused params by package
  const unusedByPackage: Record<string, number> = {};
  for (const node of unusedParamNodes) {
    unusedByPackage[node.packageOrModule] = (unusedByPackage[node.packageOrModule] || 0) + 1;
  }

  // Largest functions
  const largestFunctions = [...nodes]
    .sort((a, b) => b.linesOfCode - a.linesOfCode)
    .slice(0, 10)
    .map(n => ({ id: n.id, linesOfCode: n.linesOfCode }));

  return {
    deadFunctions: {
      count: deadNodes.length,
      percentage: total > 0 ? Math.round((deadNodes.length / total) * 10000) / 100 : 0,
      byPackage: deadByPackage,
    },
    unusedParameters: {
      count: unusedParamNodes.length,
      percentage: total > 0 ? Math.round((unusedParamNodes.length / total) * 10000) / 100 : 0,
      byPackage: unusedByPackage,
    },
    entryPoints: {
      count: entryPointIds.length,
      functions: entryPointIds,
    },
    largestFunctions,
  };
}
