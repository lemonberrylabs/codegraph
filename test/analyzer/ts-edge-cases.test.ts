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

describe('TypeScript Analyzer — Edge Cases (PRD 10.1)', () => {
  let nodes: GraphNode[];
  let edges: GraphEdge[];

  beforeAll(async () => {
    const config = createConfig();
    const analyzer = new TypeScriptAnalyzer(config);
    const result = await analyzer.analyze();
    nodes = result.nodes;
    edges = result.edges;
  });

  describe('Destructured parameters', () => {
    it('should detect unused bindings in object destructuring', () => {
      const configure = nodes.find(n => n.name === 'configure');
      expect(configure).toBeDefined();
      // timeout is unused in the function body — reported as individual binding
      expect(configure!.unusedParameters).toContain('timeout');
      expect(configure!.unusedParameters).not.toContain('verbose');
      expect(configure!.unusedParameters).not.toContain('retries');
    });

    it('should detect unused bindings in array destructuring', () => {
      const processCoords = nodes.find(n => n.name === 'processCoords');
      expect(processCoords).toBeDefined();
      // y is unused
      expect(processCoords!.unusedParameters).toContain('y');
      expect(processCoords!.unusedParameters).not.toContain('x');
      expect(processCoords!.unusedParameters).not.toContain('z');
    });

    it('should not flag fully-used destructured params', () => {
      const formatUser = nodes.find(n => n.name === 'formatUser');
      expect(formatUser).toBeDefined();
      // both name and age are used
      expect(formatUser!.unusedParameters).toHaveLength(0);
    });

    it('should handle nested destructured parameters', () => {
      const handleEvent = nodes.find(n => n.name === 'handleEvent');
      expect(handleEvent).toBeDefined();
      // payload is unused inside nested destructure
      expect(handleEvent!.unusedParameters).toContain('payload');
      expect(handleEvent!.unusedParameters).not.toContain('type');
      expect(handleEvent!.unusedParameters).not.toContain('id');
    });
  });

  describe('Constructor call edges', () => {
    it('should create edge from caller to constructor via new', () => {
      // handler.ts: new Logger('handler') should create an edge
      const ctorEdge = edges.find(
        e => e.source.includes('handleRequest') && e.target.includes('constructor')
      );
      expect(ctorEdge).toBeDefined();
      expect(ctorEdge!.kind).toBe('constructor');
      expect(ctorEdge!.isResolved).toBe(true);
    });

    it('should create edge from createService to Service constructor', () => {
      const ctorEdge = edges.find(
        e => e.source.includes('createService') && e.target.includes('constructor')
      );
      expect(ctorEdge).toBeDefined();
      expect(ctorEdge!.kind).toBe('constructor');
    });
  });

  describe('Re-exported function resolution', () => {
    it('should resolve calls through re-exports to original definition', () => {
      // checkInput imports validate from reexport.ts which re-exports from utils.ts
      // The edge should resolve to the original utils.ts:validate
      const checkInputEdge = edges.find(
        e => e.source.includes('checkInput') && e.target.includes('validate')
      );
      expect(checkInputEdge).toBeDefined();
      expect(checkInputEdge!.isResolved).toBe(true);
    });

    it('should have re-export module create valid node IDs', () => {
      // validate exists in utils.ts
      const validateNode = nodes.find(n => n.name === 'validate');
      expect(validateNode).toBeDefined();
      expect(validateNode!.filePath).toContain('utils.ts');
    });
  });

  describe('Mutual recursion dead code', () => {
    it('should detect mutually recursive functions', () => {
      const mutualAEdge = edges.find(
        e => e.source.includes('mutualA') && e.target.includes('mutualB')
      );
      const mutualBEdge = edges.find(
        e => e.source.includes('mutualB') && e.target.includes('mutualA')
      );
      expect(mutualAEdge).toBeDefined();
      expect(mutualBEdge).toBeDefined();
    });
  });
});
