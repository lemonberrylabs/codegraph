import { minimatch } from 'minimatch';
import type { GraphNode, GraphEdge, EntryPointConfig, EntryNode } from './types.js';

/**
 * Matches nodes against entry point configuration rules and marks them.
 * Returns the list of entry point node IDs.
 */
export function matchEntryPoints(
  nodes: GraphNode[],
  entryPointConfigs: EntryPointConfig[]
): string[] {
  const entryIds: Set<string> = new Set();

  for (const node of nodes) {
    for (const config of entryPointConfigs) {
      if (isEntryPoint(node, config)) {
        node.isEntryPoint = true;
        entryIds.add(node.id);
        break;
      }
    }

    // Auto-detect common entry points by language
    if (autoDetectEntryPoint(node)) {
      node.isEntryPoint = true;
      entryIds.add(node.id);
    }
  }

  return [...entryIds];
}

/** Check if a node matches a single entry point config rule */
function isEntryPoint(node: GraphNode, config: EntryPointConfig): boolean {
  switch (config.type) {
    case 'file':
      // All exported functions in matched files
      return minimatch(node.filePath, config.pattern) && node.visibility === 'exported';

    case 'function':
      // Match by function name or qualified name
      return node.name === config.name || node.qualifiedName === config.name || node.id === config.name;

    case 'decorator':
      // Match nodes that have a matching decorator
      if (!node.decorators) return false;
      return node.decorators.some(d =>
        d === config.name || d.includes(config.name)
      );

    case 'export':
      // All exported symbols from matched files
      return minimatch(node.filePath, config.pattern) && node.visibility === 'exported';

    default:
      return false;
  }
}

/** Auto-detect entry points based on language conventions */
function autoDetectEntryPoint(node: GraphNode): boolean {
  if (node.language === 'go') {
    // main() and init() functions in Go
    if (node.name === 'main' || node.name === 'init') return true;
    // Test functions
    if (node.name.startsWith('Test') || node.name.startsWith('Benchmark') || node.name.startsWith('Example')) {
      return true;
    }
  }

  if (node.language === 'python') {
    // Functions in __main__ blocks are handled at analysis time
    if (node.name === '__main__') return true;
  }

  return false;
}

/**
 * Propagate liveness from entry points through the call graph.
 * Uses BFS to mark all reachable nodes as "live".
 */
export function propagateEntryPoints(
  nodes: GraphNode[],
  edges: GraphEdge[],
  entryPointIds: string[]
): void {
  // Build adjacency list (outgoing edges)
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.source) || [];
    targets.push(edge.target);
    adjacency.set(edge.source, targets);
  }

  // BFS from entry points
  const reachable = new Set<string>();
  const queue: string[] = [...entryPointIds];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);

    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!reachable.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  // Classify nodes
  for (const node of nodes) {
    const isReachable = reachable.has(node.id);

    if (node.isEntryPoint) {
      node.status = 'entry';
      node.color = 'blue';
    } else if (isReachable) {
      node.status = 'live';
      node.color = node.unusedParameters.length > 0 ? 'yellow' : 'green';
    } else {
      node.status = 'dead';
      node.color = node.unusedParameters.length > 0 ? 'orange' : 'red';
    }
  }
}

/** Create the virtual entry node with edges to all entry points */
export function createEntryNode(entryPointIds: string[]): EntryNode {
  return {
    id: '__entry__',
    name: 'External Callers',
    targets: entryPointIds,
  };
}
