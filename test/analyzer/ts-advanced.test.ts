import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { TypeScriptAnalyzer } from '../../src/analyzer/typescript/ts-analyzer.js';
import type { ResolvedConfig, GraphNode, GraphEdge } from '../../src/analyzer/types.js';

const FIXTURE_PATH = resolve(__dirname, '../fixtures/typescript-basic');

function createConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    language: 'typescript',
    include: ['src/**/*.ts'],
    exclude: ['**/*.test.ts', '**/*.d.ts', 'node_modules/**'],
    entryPoints: [],
    output: './codegraph-output.json',
    typescript: { tsconfig: './tsconfig.json' },
    projectRoot: FIXTURE_PATH,
    ...overrides,
  };
}

describe('TypeScript Analyzer — Advanced', () => {
  let nodes: GraphNode[];
  let edges: GraphEdge[];

  beforeAll(async () => {
    const config = createConfig();
    const analyzer = new TypeScriptAnalyzer(config);
    const result = await analyzer.analyze();
    nodes = result.nodes;
    edges = result.edges;
  });

  describe('Arrow functions', () => {
    it('should detect arrow functions assigned to const', () => {
      const greet = nodes.find(n => n.name === 'greet');
      expect(greet).toBeDefined();
      expect(greet!.kind).toBe('arrow');
    });

    it('should detect all arrow functions', () => {
      const arrowNodes = nodes.filter(n => n.kind === 'arrow');
      expect(arrowNodes.length).toBeGreaterThanOrEqual(3);
    });

    it('should detect callback references in map/filter/etc', () => {
      const callbackEdge = edges.find(
        e => e.source.includes('processItems') && e.target.includes('transformItem')
      );
      expect(callbackEdge).toBeDefined();
      if (callbackEdge) {
        expect(callbackEdge.kind).toBe('callback');
      }
    });
  });

  describe('Node IDs and qualified names', () => {
    it('should use filePath:name format for top-level functions', () => {
      const validate = nodes.find(n => n.name === 'validate');
      expect(validate).toBeDefined();
      expect(validate!.id).toBe('src/utils.ts:validate');
    });

    it('should use filePath:ClassName.methodName for methods', () => {
      const logMethod = nodes.find(n => n.name === 'log' && n.kind === 'method');
      expect(logMethod).toBeDefined();
      expect(logMethod!.id).toContain('Logger.log');
    });

    it('should use filePath:ClassName.constructor for constructors', () => {
      const ctor = nodes.find(n => n.name === 'constructor');
      expect(ctor).toBeDefined();
      expect(ctor!.id).toContain('Logger.constructor');
    });
  });

  describe('Parameter extraction', () => {
    it('should extract parameter types', () => {
      const validate = nodes.find(n => n.name === 'validate');
      expect(validate).toBeDefined();
      expect(validate!.parameters.length).toBe(1);
      expect(validate!.parameters[0].name).toBe('input');
      expect(validate!.parameters[0].type).toBeTruthy();
    });

    it('should track parameter positions', () => {
      const sanitize = nodes.find(n => n.name === 'sanitize');
      expect(sanitize).toBeDefined();
      expect(sanitize!.parameters[0].position).toBe(0);
      expect(sanitize!.parameters[1].position).toBe(1);
    });

    it('should detect unused parameters in multi-param functions', () => {
      const sanitize = nodes.find(n => n.name === 'sanitize');
      expect(sanitize).toBeDefined();
      expect(sanitize!.unusedParameters).toContain('encoding');
      expect(sanitize!.unusedParameters).not.toContain('input');
    });
  });

  describe('Lines of code', () => {
    it('should calculate linesOfCode correctly', () => {
      const handleRequest = nodes.find(n => n.name === 'handleRequest');
      expect(handleRequest).toBeDefined();
      expect(handleRequest!.linesOfCode).toBeGreaterThan(1);
      expect(handleRequest!.startLine).toBeGreaterThan(0);
      expect(handleRequest!.endLine).toBeGreaterThan(handleRequest!.startLine);
    });
  });

  describe('Edge properties', () => {
    it('should have mostly resolved edges', () => {
      const resolvedEdges = edges.filter(e => e.isResolved);
      const unresolvedEdges = edges.filter(e => !e.isResolved);
      // Most edges should be resolved; only dynamic calls (obj[key]()) are unresolved
      expect(resolvedEdges.length).toBeGreaterThan(0);
      // Unresolved edges should be marked as dynamic
      for (const edge of unresolvedEdges) {
        expect(edge.kind).toBe('dynamic');
      }
    });

    it('should have valid call sites', () => {
      for (const edge of edges) {
        expect(edge.callSite.filePath).toBeTruthy();
        expect(edge.callSite.line).toBeGreaterThan(0);
        expect(edge.callSite.column).toBeGreaterThan(0);
      }
    });
  });
});
