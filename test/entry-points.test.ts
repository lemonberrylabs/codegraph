import { describe, it, expect } from 'vitest';
import { matchEntryPoints, propagateEntryPoints, createEntryNode } from '../src/analyzer/entry-points.js';
import type { GraphNode, GraphEdge } from '../src/analyzer/types.js';

function createTestNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'test.ts:testFunc',
    name: 'testFunc',
    qualifiedName: 'test.ts:testFunc',
    filePath: 'test.ts',
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    kind: 'function',
    visibility: 'exported',
    isEntryPoint: false,
    parameters: [],
    unusedParameters: [],
    packageOrModule: 'test',
    linesOfCode: 10,
    status: 'dead',
    color: 'red',
    ...overrides,
  };
}

describe('Entry Points', () => {
  describe('matchEntryPoints', () => {
    it('should match by function name', () => {
      const nodes = [
        createTestNode({ id: 'a.ts:main', name: 'main' }),
        createTestNode({ id: 'a.ts:helper', name: 'helper' }),
      ];

      const ids = matchEntryPoints(nodes, [{ type: 'function', name: 'main' }]);
      expect(ids).toContain('a.ts:main');
      expect(ids).not.toContain('a.ts:helper');
    });

    it('should match by file glob pattern', () => {
      const nodes = [
        createTestNode({ id: 'src/routes/api.ts:handler', name: 'handler', filePath: 'src/routes/api.ts', visibility: 'exported' }),
        createTestNode({ id: 'src/utils/helper.ts:helper', name: 'helper', filePath: 'src/utils/helper.ts', visibility: 'exported' }),
      ];

      const ids = matchEntryPoints(nodes, [{ type: 'file', pattern: 'src/routes/**/*.ts' }]);
      expect(ids).toContain('src/routes/api.ts:handler');
      expect(ids).not.toContain('src/utils/helper.ts:helper');
    });

    it('should auto-detect Go entry points', () => {
      const nodes = [
        createTestNode({ id: 'main.go:main', name: 'main', language: 'go' }),
        createTestNode({ id: 'init.go:init', name: 'init', language: 'go' }),
        createTestNode({ id: 'test.go:TestFoo', name: 'TestFoo', language: 'go' }),
      ];

      const ids = matchEntryPoints(nodes, []);
      expect(ids).toContain('main.go:main');
      expect(ids).toContain('init.go:init');
      expect(ids).toContain('test.go:TestFoo');
    });
  });

  describe('propagateEntryPoints', () => {
    it('should mark all reachable nodes as live', () => {
      const nodes = [
        createTestNode({ id: 'A', name: 'A' }),
        createTestNode({ id: 'B', name: 'B' }),
        createTestNode({ id: 'C', name: 'C' }),
        createTestNode({ id: 'D', name: 'D' }),
      ];

      const edges: GraphEdge[] = [
        { source: 'A', target: 'B', callSite: { filePath: 'a.ts', line: 1, column: 1 }, kind: 'direct', isResolved: true },
        { source: 'B', target: 'C', callSite: { filePath: 'a.ts', line: 2, column: 1 }, kind: 'direct', isResolved: true },
      ];

      // A is entry point, B and C are reachable, D is not
      nodes[0].isEntryPoint = true;
      propagateEntryPoints(nodes, edges, ['A']);

      expect(nodes[0].status).toBe('entry');   // A is entry
      expect(nodes[1].status).toBe('live');     // B is reachable
      expect(nodes[2].status).toBe('live');     // C is reachable
      expect(nodes[3].status).toBe('dead');     // D is unreachable
    });

    it('should color dead nodes with unused params as orange', () => {
      const nodes = [
        createTestNode({ id: 'D', name: 'D', unusedParameters: ['x'] }),
      ];

      propagateEntryPoints(nodes, [], []);

      expect(nodes[0].status).toBe('dead');
      expect(nodes[0].color).toBe('orange');
    });

    it('should color live nodes with unused params as yellow', () => {
      const nodes = [
        createTestNode({ id: 'A', name: 'A', isEntryPoint: true }),
        createTestNode({ id: 'B', name: 'B', unusedParameters: ['x'] }),
      ];

      const edges: GraphEdge[] = [
        { source: 'A', target: 'B', callSite: { filePath: 'a.ts', line: 1, column: 1 }, kind: 'direct', isResolved: true },
      ];

      propagateEntryPoints(nodes, edges, ['A']);

      expect(nodes[1].status).toBe('live');
      expect(nodes[1].color).toBe('yellow');
    });
  });

  describe('createEntryNode', () => {
    it('should create virtual entry node with targets', () => {
      const entryNode = createEntryNode(['A', 'B']);
      expect(entryNode.id).toBe('__entry__');
      expect(entryNode.name).toBe('External Callers');
      expect(entryNode.targets).toEqual(['A', 'B']);
    });
  });
});
