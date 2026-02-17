import type { CodeGraph, GraphNode, GraphEdge, Cluster } from '../../analyzer/types.js';

export interface NodeIndex {
  node: GraphNode;
  index: number;
  incomingEdges: number[];   // indices into edges array
  outgoingEdges: number[];   // indices into edges array
  neighbors: Set<number>;    // indices into nodes array
  position: { x: number; y: number; z: number };
}

/**
 * In-memory graph data store with indexing for fast lookups.
 */
export class GraphStore {
  nodes: GraphNode[] = [];
  edges: GraphEdge[] = [];
  clusters: Cluster[] = [];
  graph!: CodeGraph;

  private nodeById = new Map<string, NodeIndex>();
  private nodeByIndex = new Map<number, NodeIndex>();
  private edgeSourceIndex = new Map<string, number[]>();
  private edgeTargetIndex = new Map<string, number[]>();

  load(graph: CodeGraph): void {
    this.graph = graph;
    this.nodes = graph.nodes;
    this.edges = graph.edges;
    this.clusters = graph.clusters;
    this.buildIndices();
  }

  private buildIndices(): void {
    this.nodeById.clear();
    this.nodeByIndex.clear();
    this.edgeSourceIndex.clear();
    this.edgeTargetIndex.clear();

    // Index nodes
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const idx: NodeIndex = {
        node,
        index: i,
        incomingEdges: [],
        outgoingEdges: [],
        neighbors: new Set(),
        position: { x: 0, y: 0, z: 0 },
      };
      this.nodeById.set(node.id, idx);
      this.nodeByIndex.set(i, idx);
    }

    // Index edges
    for (let i = 0; i < this.edges.length; i++) {
      const edge = this.edges[i];
      const source = this.nodeById.get(edge.source);
      const target = this.nodeById.get(edge.target);

      if (source && target) {
        source.outgoingEdges.push(i);
        target.incomingEdges.push(i);
        source.neighbors.add(target.index);
        target.neighbors.add(source.index);

        // Edge indices by source/target
        const srcEdges = this.edgeSourceIndex.get(edge.source) || [];
        srcEdges.push(i);
        this.edgeSourceIndex.set(edge.source, srcEdges);

        const tgtEdges = this.edgeTargetIndex.get(edge.target) || [];
        tgtEdges.push(i);
        this.edgeTargetIndex.set(edge.target, tgtEdges);
      }
    }
  }

  getNodeById(id: string): NodeIndex | undefined {
    return this.nodeById.get(id);
  }

  getNodeByIndex(index: number): NodeIndex | undefined {
    return this.nodeByIndex.get(index);
  }

  getOutgoingEdges(nodeId: string): GraphEdge[] {
    const indices = this.edgeSourceIndex.get(nodeId) || [];
    return indices.map(i => this.edges[i]);
  }

  getIncomingEdges(nodeId: string): GraphEdge[] {
    const indices = this.edgeTargetIndex.get(nodeId) || [];
    return indices.map(i => this.edges[i]);
  }

  /** Get all node IDs reachable from a node by following outgoing edges */
  getReachableFrom(nodeId: string): Set<string> {
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const outgoing = this.edgeSourceIndex.get(id) || [];
      for (const ei of outgoing) {
        const target = this.edges[ei].target;
        if (!visited.has(target)) queue.push(target);
      }
    }
    return visited;
  }

  /** Get all node IDs that can reach a node by following incoming edges */
  getReachableTo(nodeId: string): Set<string> {
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const incoming = this.edgeTargetIndex.get(id) || [];
      for (const ei of incoming) {
        const source = this.edges[ei].source;
        if (!visited.has(source)) queue.push(source);
      }
    }
    return visited;
  }

  /** Get nodes matching a filter */
  getFilteredNodes(filter: {
    status?: string[];
    hasUnusedParams?: boolean;
    packageOrModule?: string[];
    minConnections?: number;
    maxConnections?: number;
  }): NodeIndex[] {
    const results: NodeIndex[] = [];

    for (const [, nodeIdx] of this.nodeById) {
      const node = nodeIdx.node;
      if (filter.status && !filter.status.includes(node.status)) continue;
      if (filter.hasUnusedParams && node.unusedParameters.length === 0) continue;
      if (filter.packageOrModule && !filter.packageOrModule.includes(node.packageOrModule)) continue;

      const connections = nodeIdx.incomingEdges.length + nodeIdx.outgoingEdges.length;
      if (filter.minConnections !== undefined && connections < filter.minConnections) continue;
      if (filter.maxConnections !== undefined && connections > filter.maxConnections) continue;

      results.push(nodeIdx);
    }

    return results;
  }

  get nodeCount(): number { return this.nodes.length; }
  get edgeCount(): number { return this.edges.length; }
}
