import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../src/viewer/data/graph-store.js';
import type { CodeGraph, GraphNode, GraphEdge } from '../src/analyzer/types.js';

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    name: id.split(':').pop()!,
    qualifiedName: id,
    filePath: id.split(':')[0],
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    kind: 'function',
    visibility: 'exported',
    isEntryPoint: false,
    parameters: [],
    unusedParameters: [],
    packageOrModule: id.split('/')[0] || 'root',
    linesOfCode: 10,
    status: 'live',
    color: 'green',
    ...overrides,
  };
}

function makeEdge(source: string, target: string, overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    source,
    target,
    callSite: { filePath: source.split(':')[0], line: 5, column: 3 },
    kind: 'direct',
    isResolved: true,
    ...overrides,
  };
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): CodeGraph {
  return {
    metadata: {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      language: 'typescript',
      projectRoot: '/test',
      analysisTimeMs: 100,
      totalFiles: 1,
      totalFunctions: nodes.length,
      totalEdges: edges.length,
      totalDeadFunctions: 0,
      totalUnusedParameters: 0,
      config: {} as any,
    },
    nodes,
    edges,
    entryNode: { id: '__entry__', name: 'External Callers', targets: [] },
    clusters: [],
    stats: {
      deadFunctions: { count: 0, percentage: 0, byPackage: {} },
      unusedParameters: { count: 0, percentage: 0, byPackage: {} },
      entryPoints: { count: 0, functions: [] },
      largestFunctions: [],
    },
  };
}

describe('GraphStore', () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  describe('load and indexing', () => {
    it('should load graph data and index nodes', () => {
      const nodes = [makeNode('a.ts:foo'), makeNode('b.ts:bar')];
      const edges = [makeEdge('a.ts:foo', 'b.ts:bar')];
      store.load(makeGraph(nodes, edges));

      expect(store.nodeCount).toBe(2);
      expect(store.edgeCount).toBe(1);
    });

    it('should index nodes by ID', () => {
      const nodes = [makeNode('a.ts:foo'), makeNode('b.ts:bar')];
      store.load(makeGraph(nodes, []));

      const foo = store.getNodeById('a.ts:foo');
      expect(foo).toBeDefined();
      expect(foo!.node.name).toBe('foo');
      expect(foo!.index).toBe(0);
    });

    it('should index nodes by position', () => {
      const nodes = [makeNode('a.ts:foo'), makeNode('b.ts:bar')];
      store.load(makeGraph(nodes, []));

      const node1 = store.getNodeByIndex(1);
      expect(node1).toBeDefined();
      expect(node1!.node.name).toBe('bar');
    });

    it('should return undefined for unknown IDs', () => {
      store.load(makeGraph([], []));
      expect(store.getNodeById('nonexistent')).toBeUndefined();
      expect(store.getNodeByIndex(999)).toBeUndefined();
    });
  });

  describe('edge indexing', () => {
    it('should track incoming and outgoing edges', () => {
      const nodes = [makeNode('a.ts:foo'), makeNode('b.ts:bar'), makeNode('c.ts:baz')];
      const edges = [
        makeEdge('a.ts:foo', 'b.ts:bar'),
        makeEdge('a.ts:foo', 'c.ts:baz'),
        makeEdge('b.ts:bar', 'c.ts:baz'),
      ];
      store.load(makeGraph(nodes, edges));

      const foo = store.getNodeById('a.ts:foo')!;
      expect(foo.outgoingEdges.length).toBe(2);
      expect(foo.incomingEdges.length).toBe(0);

      const baz = store.getNodeById('c.ts:baz')!;
      expect(baz.incomingEdges.length).toBe(2);
      expect(baz.outgoingEdges.length).toBe(0);
    });

    it('should compute neighbors bidirectionally', () => {
      const nodes = [makeNode('a.ts:foo'), makeNode('b.ts:bar'), makeNode('c.ts:baz')];
      const edges = [makeEdge('a.ts:foo', 'b.ts:bar')];
      store.load(makeGraph(nodes, edges));

      const foo = store.getNodeById('a.ts:foo')!;
      expect(foo.neighbors.has(1)).toBe(true); // bar is neighbor

      const bar = store.getNodeById('b.ts:bar')!;
      expect(bar.neighbors.has(0)).toBe(true); // foo is neighbor

      const baz = store.getNodeById('c.ts:baz')!;
      expect(baz.neighbors.size).toBe(0); // no neighbors
    });

    it('should get outgoing edges by node ID', () => {
      const nodes = [makeNode('a.ts:foo'), makeNode('b.ts:bar')];
      const edges = [makeEdge('a.ts:foo', 'b.ts:bar')];
      store.load(makeGraph(nodes, edges));

      const outgoing = store.getOutgoingEdges('a.ts:foo');
      expect(outgoing.length).toBe(1);
      expect(outgoing[0].target).toBe('b.ts:bar');
    });

    it('should get incoming edges by node ID', () => {
      const nodes = [makeNode('a.ts:foo'), makeNode('b.ts:bar')];
      const edges = [makeEdge('a.ts:foo', 'b.ts:bar')];
      store.load(makeGraph(nodes, edges));

      const incoming = store.getIncomingEdges('b.ts:bar');
      expect(incoming.length).toBe(1);
      expect(incoming[0].source).toBe('a.ts:foo');
    });
  });

  describe('reachability — getReachableFrom', () => {
    it('should compute downstream reachability', () => {
      // A → B → C, A → D (separate chain)
      const nodes = [makeNode('a:A'), makeNode('b:B'), makeNode('c:C'), makeNode('d:D')];
      const edges = [
        makeEdge('a:A', 'b:B'),
        makeEdge('b:B', 'c:C'),
        makeEdge('a:A', 'd:D'),
      ];
      store.load(makeGraph(nodes, edges));

      const reachable = store.getReachableFrom('a:A');
      expect(reachable.has('a:A')).toBe(true); // includes self
      expect(reachable.has('b:B')).toBe(true);
      expect(reachable.has('c:C')).toBe(true);
      expect(reachable.has('d:D')).toBe(true);
      expect(reachable.size).toBe(4);
    });

    it('should handle cycles without infinite loop', () => {
      const nodes = [makeNode('a:A'), makeNode('b:B')];
      const edges = [makeEdge('a:A', 'b:B'), makeEdge('b:B', 'a:A')];
      store.load(makeGraph(nodes, edges));

      const reachable = store.getReachableFrom('a:A');
      expect(reachable.has('a:A')).toBe(true);
      expect(reachable.has('b:B')).toBe(true);
      expect(reachable.size).toBe(2);
    });

    it('should return only self for leaf node', () => {
      const nodes = [makeNode('a:A'), makeNode('b:B')];
      const edges = [makeEdge('a:A', 'b:B')];
      store.load(makeGraph(nodes, edges));

      const reachable = store.getReachableFrom('b:B');
      expect(reachable.size).toBe(1);
      expect(reachable.has('b:B')).toBe(true);
    });
  });

  describe('reachability — getReachableTo', () => {
    it('should compute upstream reachability', () => {
      // A → B → C
      const nodes = [makeNode('a:A'), makeNode('b:B'), makeNode('c:C')];
      const edges = [makeEdge('a:A', 'b:B'), makeEdge('b:B', 'c:C')];
      store.load(makeGraph(nodes, edges));

      const reachable = store.getReachableTo('c:C');
      expect(reachable.has('c:C')).toBe(true);
      expect(reachable.has('b:B')).toBe(true);
      expect(reachable.has('a:A')).toBe(true);
    });

    it('should return only self for root node', () => {
      const nodes = [makeNode('a:A'), makeNode('b:B')];
      const edges = [makeEdge('a:A', 'b:B')];
      store.load(makeGraph(nodes, edges));

      const reachable = store.getReachableTo('a:A');
      expect(reachable.size).toBe(1);
    });
  });

  describe('getFilteredNodes', () => {
    it('should filter by status', () => {
      const nodes = [
        makeNode('a:A', { status: 'live' }),
        makeNode('b:B', { status: 'dead' }),
        makeNode('c:C', { status: 'dead' }),
      ];
      store.load(makeGraph(nodes, []));

      const dead = store.getFilteredNodes({ status: ['dead'] });
      expect(dead.length).toBe(2);
    });

    it('should filter by unused params', () => {
      const nodes = [
        makeNode('a:A', { unusedParameters: ['x'] }),
        makeNode('b:B', { unusedParameters: [] }),
      ];
      store.load(makeGraph(nodes, []));

      const withUnused = store.getFilteredNodes({ hasUnusedParams: true });
      expect(withUnused.length).toBe(1);
      expect(withUnused[0].node.id).toBe('a:A');
    });

    it('should filter by package', () => {
      const nodes = [
        makeNode('src/utils/a.ts:A', { packageOrModule: 'src/utils' }),
        makeNode('src/core/b.ts:B', { packageOrModule: 'src/core' }),
      ];
      store.load(makeGraph(nodes, []));

      const utils = store.getFilteredNodes({ packageOrModule: ['src/utils'] });
      expect(utils.length).toBe(1);
    });

    it('should filter by connection count', () => {
      const nodes = [makeNode('a:A'), makeNode('b:B'), makeNode('c:C')];
      const edges = [
        makeEdge('a:A', 'b:B'),
        makeEdge('a:A', 'c:C'),
        makeEdge('b:B', 'c:C'),
      ];
      store.load(makeGraph(nodes, edges));

      // A has 2 outgoing = 2 connections total
      // B has 1 in + 1 out = 2 connections
      // C has 2 incoming = 2 connections
      const highConn = store.getFilteredNodes({ minConnections: 2 });
      expect(highConn.length).toBe(3);

      const lowConn = store.getFilteredNodes({ maxConnections: 1 });
      expect(lowConn.length).toBe(0);
    });

    it('should combine multiple filters', () => {
      const nodes = [
        makeNode('a:A', { status: 'dead', unusedParameters: ['x'] }),
        makeNode('b:B', { status: 'dead', unusedParameters: [] }),
        makeNode('c:C', { status: 'live', unusedParameters: ['y'] }),
      ];
      store.load(makeGraph(nodes, []));

      const deadWithUnused = store.getFilteredNodes({
        status: ['dead'],
        hasUnusedParams: true,
      });
      expect(deadWithUnused.length).toBe(1);
      expect(deadWithUnused[0].node.id).toBe('a:A');
    });
  });

  describe('re-load', () => {
    it('should clear indices and rebuild on reload', () => {
      const graph1 = makeGraph([makeNode('a:A')], []);
      store.load(graph1);
      expect(store.nodeCount).toBe(1);

      const graph2 = makeGraph([makeNode('b:B'), makeNode('c:C')], []);
      store.load(graph2);
      expect(store.nodeCount).toBe(2);
      expect(store.getNodeById('a:A')).toBeUndefined();
      expect(store.getNodeById('b:B')).toBeDefined();
    });
  });
});
