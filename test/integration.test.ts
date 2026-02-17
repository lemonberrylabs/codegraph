import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import type { CodeGraph } from '../src/analyzer/types.js';

const PROJECT_ROOT = resolve(__dirname, '..');
const FIXTURE_PATH = resolve(__dirname, 'fixtures/typescript-basic');
const CLI_PATH = resolve(PROJECT_ROOT, 'dist/bin/codegraph.js');
const OUTPUT_PATH = resolve(FIXTURE_PATH, 'codegraph-output.json');

describe('Integration: CLI end-to-end', () => {
  it('should analyze a TypeScript project and produce valid JSON', () => {
    // Clean up any previous output
    if (existsSync(OUTPUT_PATH)) {
      unlinkSync(OUTPUT_PATH);
    }

    // Run the CLI
    const result = execSync(
      `node ${CLI_PATH} analyze --root ${FIXTURE_PATH} --language typescript --entry "src/main.ts"`,
      { encoding: 'utf-8', timeout: 30000 }
    );

    expect(result).toContain('Analysis complete');
    expect(existsSync(OUTPUT_PATH)).toBe(true);

    // Parse and validate the output
    const json = readFileSync(OUTPUT_PATH, 'utf-8');
    const graph: CodeGraph = JSON.parse(json);

    // Validate schema
    expect(graph.metadata).toBeDefined();
    expect(graph.metadata.version).toBe('1.0.0');
    expect(graph.metadata.language).toBe('typescript');
    expect(graph.nodes).toBeInstanceOf(Array);
    expect(graph.edges).toBeInstanceOf(Array);
    expect(graph.entryNode).toBeDefined();
    expect(graph.clusters).toBeInstanceOf(Array);
    expect(graph.stats).toBeDefined();

    // Validate node structure
    for (const node of graph.nodes) {
      expect(node.id).toBeTruthy();
      expect(node.name).toBeTruthy();
      expect(node.filePath).toBeTruthy();
      expect(node.startLine).toBeGreaterThan(0);
      expect(node.endLine).toBeGreaterThanOrEqual(node.startLine);
      expect(node.language).toBe('typescript');
      expect(['function', 'method', 'constructor', 'arrow', 'closure', 'lambda']).toContain(node.kind);
      expect(['exported', 'public', 'private', 'internal', 'module']).toContain(node.visibility);
      expect(['live', 'dead', 'entry']).toContain(node.status);
      expect(['green', 'red', 'yellow', 'orange', 'blue']).toContain(node.color);
      expect(node.parameters).toBeInstanceOf(Array);
      expect(node.unusedParameters).toBeInstanceOf(Array);
      expect(node.linesOfCode).toBeGreaterThan(0);
    }

    // Validate edge structure
    for (const edge of graph.edges) {
      expect(edge.source).toBeTruthy();
      expect(edge.target).toBeTruthy();
      expect(edge.callSite.filePath).toBeTruthy();
      expect(edge.callSite.line).toBeGreaterThan(0);
      expect(['direct', 'method', 'constructor', 'callback', 'dynamic']).toContain(edge.kind);
    }

    // Validate stats
    expect(graph.stats.deadFunctions.count).toBeGreaterThanOrEqual(0);
    expect(graph.stats.unusedParameters.count).toBeGreaterThanOrEqual(0);
    expect(graph.stats.entryPoints.count).toBeGreaterThan(0);

    // Validate entry node
    expect(graph.entryNode.id).toBe('__entry__');
    expect(graph.entryNode.targets.length).toBeGreaterThan(0);
  });

  it('should load config from codegraph.config.json', () => {
    // The fixture has a codegraph.config.json
    const result = execSync(
      `node ${CLI_PATH} analyze --root ${FIXTURE_PATH}`,
      { encoding: 'utf-8', timeout: 30000 }
    );

    expect(result).toContain('Analysis complete');
    expect(result).toContain('Entry points: 2 rules');
  });

  it('should report dead functions correctly', () => {
    const json = readFileSync(OUTPUT_PATH, 'utf-8');
    const graph: CodeGraph = JSON.parse(json);

    const deadNodes = graph.nodes.filter(n => n.status === 'dead');
    const deadNames = deadNodes.map(n => n.name);

    // deadFunction and anotherDeadFunction should be dead
    expect(deadNames).toContain('deadFunction');
    expect(deadNames).toContain('anotherDeadFunction');

    // main and handleRequest should NOT be dead
    expect(deadNames).not.toContain('main');
    expect(deadNames).not.toContain('handleRequest');
  });

  it('should report unused parameters correctly', () => {
    const json = readFileSync(OUTPUT_PATH, 'utf-8');
    const graph: CodeGraph = JSON.parse(json);

    const nodesWithUnused = graph.nodes.filter(n => n.unusedParameters.length > 0);

    // formatOutput has 'unusedParam'
    const formatOutput = nodesWithUnused.find(n => n.name === 'formatOutput');
    expect(formatOutput).toBeDefined();
    expect(formatOutput!.unusedParameters).toContain('unusedParam');
  });
});
