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

describe('TypeScript Analyzer — Advanced Patterns', () => {
  let nodes: GraphNode[];
  let edges: GraphEdge[];

  beforeAll(async () => {
    const config = createConfig();
    const analyzer = new TypeScriptAnalyzer(config);
    const result = await analyzer.analyze();
    nodes = result.nodes;
    edges = result.edges;
  });

  describe('Chained calls', () => {
    it('should resolve calls in chained expressions', () => {
      // runQuery calls createQuery
      const createQueryEdge = edges.find(
        e => e.source.includes('runQuery') && e.target.includes('createQuery')
      );
      expect(createQueryEdge).toBeDefined();
    });

    it('should extract QueryBuilder methods', () => {
      const where = nodes.find(n => n.name === 'where' && n.filePath.includes('advanced'));
      const orderBy = nodes.find(n => n.name === 'orderBy' && n.filePath.includes('advanced'));
      const execute = nodes.find(n => n.name === 'execute' && n.filePath.includes('advanced'));

      expect(where).toBeDefined();
      expect(orderBy).toBeDefined();
      expect(execute).toBeDefined();
    });
  });

  describe('Dynamic calls', () => {
    it('should create unresolved edge for dynamic dispatch', () => {
      const dynamicEdge = edges.find(
        e => e.source.includes('dispatchDynamic') && e.isResolved === false
      );
      expect(dynamicEdge).toBeDefined();
      if (dynamicEdge) {
        expect(dynamicEdge.kind).toBe('dynamic');
      }
    });
  });

  describe('Generic functions', () => {
    it('should extract generic functions as regular nodes', () => {
      const identity = nodes.find(n => n.name === 'identity' && n.filePath.includes('advanced'));
      expect(identity).toBeDefined();
      expect(identity!.kind).toBe('function');
    });

    it('should resolve calls to generic functions', () => {
      const identityEdge = edges.find(
        e => e.source.includes('wrapValue') && e.target.includes('identity')
      );
      expect(identityEdge).toBeDefined();
    });
  });

  describe('Builder pattern class', () => {
    it('should extract constructor for QueryBuilder', () => {
      const queryBuilderNode = nodes.find(n => n.name === 'createQuery' && n.filePath.includes('advanced'));
      expect(queryBuilderNode).toBeDefined();
    });

    it('should detect correct visibility for class methods', () => {
      const where = nodes.find(n => n.name === 'where' && n.filePath.includes('advanced'));
      expect(where).toBeDefined();
      expect(where!.visibility).toBe('public'); // class methods default to public
    });
  });

  describe('Function parameter analysis', () => {
    it('should detect unused parameter in orderBy', () => {
      const orderBy = nodes.find(n => n.name === 'orderBy' && n.filePath.includes('advanced'));
      expect(orderBy).toBeDefined();
      // orderBy has param "field" which is unused (returns this)
      expect(orderBy!.unusedParameters).toContain('field');
    });

    it('should detect unused condition param in where', () => {
      const where = nodes.find(n => n.name === 'where' && n.filePath.includes('advanced'));
      expect(where).toBeDefined();
      expect(where!.unusedParameters).toContain('condition');
    });
  });
});
