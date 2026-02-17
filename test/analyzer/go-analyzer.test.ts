import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import type { ResolvedConfig, GraphNode, GraphEdge } from '../../src/analyzer/types.js';

const FIXTURE_PATH = resolve(__dirname, '../fixtures/go-basic');
const INTERFACES_FIXTURE = resolve(__dirname, '../fixtures/go-interfaces');

// Check if Go is available
let goAvailable = false;
try {
  execSync('go version', { stdio: 'pipe' });
  goAvailable = true;
} catch {
  // Go not available
}

describe.skipIf(!goAvailable)('Go Analyzer', () => {
  let nodes: GraphNode[];
  let edges: GraphEdge[];

  beforeAll(async () => {
    const { GoAnalyzer } = await import('../../src/analyzer/go/go-analyzer.js');

    const config: ResolvedConfig = {
      language: 'go',
      include: ['**/*.go'],
      exclude: ['**/*_test.go', 'vendor/**'],
      entryPoints: [],
      output: './codegraph-output.json',
      projectRoot: FIXTURE_PATH,
    };

    const analyzer = new GoAnalyzer(config);
    const result = await analyzer.analyze();
    nodes = result.nodes;
    edges = result.edges;
  }, 30000);

  describe('Node extraction', () => {
    it('should extract Go functions', () => {
      const mainFunc = nodes.find(n => n.name === 'main');
      expect(mainFunc).toBeDefined();
      expect(mainFunc!.language).toBe('go');
      expect(mainFunc!.kind).toBe('function');
    });

    it('should extract all functions across files', () => {
      // main, formatOutput, handleRequest, processData, validate, sanitize, deadFunction, anotherDeadFunction
      expect(nodes.length).toBeGreaterThanOrEqual(8);
    });

    it('should detect exported vs unexported visibility', () => {
      const mainFunc = nodes.find(n => n.name === 'main');
      expect(mainFunc!.visibility).toBe('module'); // main is lowercase
    });

    it('should auto-mark main as entry point', () => {
      const mainFunc = nodes.find(n => n.name === 'main');
      expect(mainFunc).toBeDefined();
      expect(mainFunc!.isEntryPoint).toBe(true);
    });
  });

  describe('Unused parameter detection', () => {
    it('should detect unused parameters', () => {
      const formatOutput = nodes.find(n => n.name === 'formatOutput');
      expect(formatOutput).toBeDefined();
      expect(formatOutput!.unusedParameters).toContain('unusedParam');
    });

    it('should detect unused encoding param in sanitize', () => {
      const sanitize = nodes.find(n => n.name === 'sanitize');
      expect(sanitize).toBeDefined();
      expect(sanitize!.unusedParameters).toContain('encoding');
    });

    it('should not flag used parameters', () => {
      const validate = nodes.find(n => n.name === 'validate');
      expect(validate).toBeDefined();
      expect(validate!.unusedParameters).toHaveLength(0);
    });

    it('should detect multiple unused params', () => {
      const anotherDead = nodes.find(n => n.name === 'anotherDeadFunction');
      expect(anotherDead).toBeDefined();
      expect(anotherDead!.unusedParameters).toContain('param1');
      expect(anotherDead!.unusedParameters).toContain('param2');
    });
  });

  describe('Call resolution', () => {
    it('should resolve function calls within the project', () => {
      const mainToHandle = edges.find(
        e => e.source.includes('main') && e.target.includes('handleRequest')
      );
      expect(mainToHandle).toBeDefined();
    });

    it('should resolve calls across files', () => {
      const handleToValidate = edges.find(
        e => e.source.includes('handleRequest') && e.target.includes('validate')
      );
      expect(handleToValidate).toBeDefined();
    });

    it('should resolve internal function calls', () => {
      const handleToProcess = edges.find(
        e => e.source.includes('handleRequest') && e.target.includes('processData')
      );
      expect(handleToProcess).toBeDefined();
    });
  });

  describe('Parameter extraction', () => {
    it('should extract parameter types', () => {
      const handleRequest = nodes.find(n => n.name === 'handleRequest');
      expect(handleRequest).toBeDefined();
      expect(handleRequest!.parameters.length).toBe(1);
      expect(handleRequest!.parameters[0].name).toBe('input');
      expect(handleRequest!.parameters[0].type).toBe('string');
    });

    it('should track parameter positions', () => {
      const sanitize = nodes.find(n => n.name === 'sanitize');
      expect(sanitize).toBeDefined();
      expect(sanitize!.parameters[0].position).toBe(0);
      expect(sanitize!.parameters[1].position).toBe(1);
    });
  });
});

describe.skipIf(!goAvailable)('Go Analyzer - Interface Dispatch', () => {
  let nodes: GraphNode[];
  let edges: GraphEdge[];

  beforeAll(async () => {
    const { GoAnalyzer } = await import('../../src/analyzer/go/go-analyzer.js');

    const config: ResolvedConfig = {
      language: 'go',
      include: ['**/*.go'],
      exclude: ['**/*_test.go', 'vendor/**'],
      entryPoints: [],
      output: './codegraph-output.json',
      projectRoot: INTERFACES_FIXTURE,
    };

    const analyzer = new GoAnalyzer(config);
    const result = await analyzer.analyze();
    nodes = result.nodes;
    edges = result.edges;
  }, 30000);

  it('should extract all functions and methods', () => {
    // main, run, ServiceA.Process, ServiceB.Process, format
    expect(nodes.length).toBeGreaterThanOrEqual(5);
  });

  it('should extract interface method implementations as methods', () => {
    const processA = nodes.find(n => n.name === 'Process' && n.qualifiedName.includes('ServiceA'));
    const processB = nodes.find(n => n.name === 'Process' && n.qualifiedName.includes('ServiceB'));
    expect(processA).toBeDefined();
    expect(processB).toBeDefined();
    expect(processA!.kind).toBe('method');
    expect(processB!.kind).toBe('method');
  });

  it('should create edges for interface method calls from main', () => {
    // main() calls svc.Process() through Service interface
    // Should create edges to both ServiceA.Process and ServiceB.Process
    const mainToA = edges.find(
      e => e.source.includes('main') && e.target.includes('ServiceA.Process')
    );
    const mainToB = edges.find(
      e => e.source.includes('main') && e.target.includes('ServiceB.Process')
    );
    expect(mainToA).toBeDefined();
    expect(mainToB).toBeDefined();
  });

  it('should resolve interface calls through function parameters', () => {
    // run() calls svc.Process() through Service interface parameter
    const runToA = edges.find(
      e => e.source.includes('run') && e.target.includes('ServiceA.Process')
    );
    const runToB = edges.find(
      e => e.source.includes('run') && e.target.includes('ServiceB.Process')
    );
    expect(runToA).toBeDefined();
    expect(runToB).toBeDefined();
  });

  it('should resolve direct function calls within methods', () => {
    // ServiceB.Process calls format()
    const bToFormat = edges.find(
      e => e.source.includes('ServiceB.Process') && e.target.includes('format')
    );
    expect(bToFormat).toBeDefined();
  });

  it('should resolve direct call from main to run', () => {
    const mainToRun = edges.find(
      e => e.source.includes('main') && e.target.includes('run')
    );
    expect(mainToRun).toBeDefined();
  });

  it('should mark interface dispatch edges with kind "interface"', () => {
    const ifaceEdge = edges.find(
      e => e.source.includes('main') && e.target.includes('ServiceA.Process')
    );
    expect(ifaceEdge).toBeDefined();
    expect(ifaceEdge!.kind).toBe('interface');
  });
});
