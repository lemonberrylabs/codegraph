import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { runAnalysis } from '../src/analyzer/graph-builder.js';
import type { ResolvedConfig } from '../src/analyzer/types.js';

const FIXTURE_PATH = resolve(__dirname, 'fixtures/typescript-basic');

describe('Graph Builder', () => {
  it('should produce a complete CodeGraph from TypeScript project', async () => {
    const config: ResolvedConfig = {
      language: 'typescript',
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'node_modules/**'],
      entryPoints: [{ type: 'function', name: 'main' }],
      output: './codegraph-output.json',
      typescript: { tsconfig: './tsconfig.json' },
      projectRoot: FIXTURE_PATH,
    };

    const graph = await runAnalysis(config);

    // Check metadata
    expect(graph.metadata.version).toBe('1.0.0');
    expect(graph.metadata.language).toBe('typescript');
    expect(graph.metadata.totalFunctions).toBeGreaterThan(0);
    expect(graph.metadata.totalEdges).toBeGreaterThan(0);
    expect(graph.metadata.analysisTimeMs).toBeGreaterThan(0);

    // Check nodes exist
    expect(graph.nodes.length).toBeGreaterThan(0);

    // Check edges exist
    expect(graph.edges.length).toBeGreaterThan(0);

    // Check entry node
    expect(graph.entryNode.id).toBe('__entry__');
    expect(graph.entryNode.targets.length).toBeGreaterThan(0);

    // Check clusters
    expect(graph.clusters.length).toBeGreaterThan(0);

    // Check stats
    expect(graph.stats.deadFunctions.count).toBeGreaterThanOrEqual(0);
    expect(graph.stats.entryPoints.count).toBeGreaterThan(0);
  });

  it('should calculate correct stats', async () => {
    const config: ResolvedConfig = {
      language: 'typescript',
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'node_modules/**'],
      entryPoints: [{ type: 'function', name: 'main' }],
      output: './codegraph-output.json',
      typescript: { tsconfig: './tsconfig.json' },
      projectRoot: FIXTURE_PATH,
    };

    const graph = await runAnalysis(config);

    // Dead functions should include deadFunction and anotherDeadFunction at minimum
    expect(graph.stats.deadFunctions.count).toBeGreaterThanOrEqual(1);

    // There should be functions with unused parameters
    expect(graph.stats.unusedParameters.count).toBeGreaterThanOrEqual(1);

    // Percentages should be valid
    expect(graph.stats.deadFunctions.percentage).toBeGreaterThanOrEqual(0);
    expect(graph.stats.deadFunctions.percentage).toBeLessThanOrEqual(100);
  });

  it('should build clusters from package/module assignments', async () => {
    const config: ResolvedConfig = {
      language: 'typescript',
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'node_modules/**'],
      entryPoints: [],
      output: './codegraph-output.json',
      typescript: { tsconfig: './tsconfig.json' },
      projectRoot: FIXTURE_PATH,
    };

    const graph = await runAnalysis(config);

    // All nodes should belong to at least one cluster
    const allClusterNodeIds = graph.clusters.flatMap(c => c.nodeIds);
    for (const node of graph.nodes) {
      expect(allClusterNodeIds).toContain(node.id);
    }
  });
});
