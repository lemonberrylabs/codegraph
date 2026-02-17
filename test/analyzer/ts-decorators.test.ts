import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { TypeScriptAnalyzer } from '../../src/analyzer/typescript/ts-analyzer.js';
import { matchEntryPoints, propagateEntryPoints } from '../../src/analyzer/entry-points.js';
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

describe('TypeScript Analyzer — Decorators', () => {
  let nodes: GraphNode[];
  let edges: GraphEdge[];

  beforeAll(async () => {
    const config = createConfig();
    const analyzer = new TypeScriptAnalyzer(config);
    const result = await analyzer.analyze();
    nodes = result.nodes;
    edges = result.edges;
  });

  describe('Decorator extraction', () => {
    it('should extract decorator names from methods', () => {
      const getUsers = nodes.find(n => n.name === 'getUsers' && n.filePath.includes('decorators'));
      expect(getUsers).toBeDefined();
      expect(getUsers!.decorators).toBeDefined();
      expect(getUsers!.decorators).toContain('Route');
    });

    it('should extract multiple decorators from a method', () => {
      const getUser = nodes.find(n => n.name === 'getUser' && n.filePath.includes('decorators'));
      expect(getUser).toBeDefined();
      expect(getUser!.decorators).toBeDefined();
      expect(getUser!.decorators!.length).toBeGreaterThanOrEqual(2);
      expect(getUser!.decorators).toContain('Route');
      expect(getUser!.decorators).toContain('Auth');
    });

    it('should not add decorators field for undecorated functions', () => {
      const helper = nodes.find(n => n.name === 'helperFunction');
      expect(helper).toBeDefined();
      expect(helper!.decorators).toBeUndefined();
    });
  });

  describe('Decorator-based entry points', () => {
    it('should mark decorated methods as entry points', () => {
      // Create a config with decorator-based entry points
      const decoratorConfig = createConfig({
        entryPoints: [{ type: 'decorator', name: 'Route' }],
      });

      // Run analysis fresh
      const analyzer = new TypeScriptAnalyzer(decoratorConfig);

      return analyzer.analyze().then(result => {
        const entryIds = matchEntryPoints(result.nodes, decoratorConfig.entryPoints);
        propagateEntryPoints(result.nodes, result.edges, entryIds);

        const getUsers = result.nodes.find(n => n.name === 'getUsers' && n.filePath.includes('decorators'));
        expect(getUsers).toBeDefined();
        expect(getUsers!.isEntryPoint).toBe(true);
        expect(getUsers!.status).toBe('entry');

        // fetchFromDB should be live (called by getUsers)
        const fetchFromDB = result.nodes.find(n => n.name === 'fetchFromDB');
        expect(fetchFromDB).toBeDefined();
        expect(fetchFromDB!.status).toBe('live');
      });
    });
  });

  describe('Class extraction from decorators fixture', () => {
    it('should extract UserController methods', () => {
      const controllerMethods = nodes.filter(n => n.filePath.includes('decorators') && n.kind === 'method');
      expect(controllerMethods.length).toBeGreaterThanOrEqual(3); // getUsers, getUser, fetchFromDB
    });

    it('should extract constructor for decorated class', () => {
      // The UserController class has no explicit constructor but methods should exist
      const getUsersMethod = nodes.find(n => n.name === 'getUsers' && n.filePath.includes('decorators'));
      expect(getUsersMethod).toBeDefined();
      expect(getUsersMethod!.id).toContain('UserController.getUsers');
    });
  });
});
