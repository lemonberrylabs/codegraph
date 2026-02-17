import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import type { ResolvedConfig, GraphNode, GraphEdge } from '../../src/analyzer/types.js';

const FIXTURE_PATH = resolve(__dirname, '../fixtures/python-basic');

// Check if Python is available
let pythonAvailable = false;
try {
  execSync('python3 --version', { stdio: 'pipe' });
  pythonAvailable = true;
} catch {
  try {
    execSync('python --version', { stdio: 'pipe' });
    pythonAvailable = true;
  } catch {
    // Python not available
  }
}

describe.skipIf(!pythonAvailable)('Python Analyzer', () => {
  let nodes: GraphNode[];
  let edges: GraphEdge[];

  beforeAll(async () => {
    const { PythonAnalyzer } = await import('../../src/analyzer/python/py-analyzer.js');

    const config: ResolvedConfig = {
      language: 'python',
      include: ['src/**/*.py'],
      exclude: ['**/__pycache__/**', '**/*.pyc'],
      entryPoints: [],
      output: './codegraph-output.json',
      projectRoot: FIXTURE_PATH,
    };

    const analyzer = new PythonAnalyzer(config);
    const result = await analyzer.analyze();
    nodes = result.nodes;
    edges = result.edges;
  });

  describe('Node extraction', () => {
    it('should extract Python functions', () => {
      const mainFunc = nodes.find(n => n.name === 'main');
      expect(mainFunc).toBeDefined();
      expect(mainFunc!.language).toBe('python');
      expect(mainFunc!.kind).toBe('function');
    });

    it('should extract all functions across files', () => {
      expect(nodes.length).toBeGreaterThanOrEqual(6); // main, format_output, handle_request, process_data, validate, sanitize, dead_function, another_dead_function
    });

    it('should detect visibility based on naming convention', () => {
      const mainFunc = nodes.find(n => n.name === 'main');
      expect(mainFunc!.visibility).toBe('exported');
    });
  });

  describe('Unused parameter detection', () => {
    it('should detect unused parameters', () => {
      const formatOutput = nodes.find(n => n.name === 'format_output');
      expect(formatOutput).toBeDefined();
      expect(formatOutput!.unusedParameters).toContain('unused_param');
    });

    it('should detect unused params in sanitize', () => {
      const sanitize = nodes.find(n => n.name === 'sanitize');
      expect(sanitize).toBeDefined();
      expect(sanitize!.unusedParameters).toContain('encoding');
    });

    it('should not flag used parameters', () => {
      const validate = nodes.find(n => n.name === 'validate');
      expect(validate).toBeDefined();
      expect(validate!.unusedParameters).toHaveLength(0);
    });
  });

  describe('Call resolution', () => {
    it('should resolve function calls within the same project', () => {
      const mainToHandle = edges.find(
        e => e.source.includes('main') && e.target.includes('handle_request')
      );
      expect(mainToHandle).toBeDefined();
    });

    it('should resolve calls across files', () => {
      const handleToValidate = edges.find(
        e => e.source.includes('handle_request') && e.target.includes('validate')
      );
      expect(handleToValidate).toBeDefined();
    });
  });
});
