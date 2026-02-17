import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { TypeScriptAnalyzer } from '../src/analyzer/typescript/ts-analyzer.js';
import type { ResolvedConfig } from '../src/analyzer/types.js';

const PERF_FIXTURE_PATH = resolve(__dirname, 'fixtures/typescript-perf');
const SRC_DIR = resolve(PERF_FIXTURE_PATH, 'src');

// Number of files and functions to generate
const FILE_COUNT = 50;
const FUNCTIONS_PER_FILE = 20; // Total: 1000 functions
const CALLS_PER_FUNCTION = 3;

function generateFixture(): void {
  if (existsSync(SRC_DIR)) {
    rmSync(SRC_DIR, { recursive: true });
  }
  mkdirSync(SRC_DIR, { recursive: true });

  // Generate source files with cross-file calls
  for (let f = 0; f < FILE_COUNT; f++) {
    let code = `// Generated performance test file ${f}\n\n`;

    for (let fn = 0; fn < FUNCTIONS_PER_FILE; fn++) {
      const funcName = `func_${f}_${fn}`;
      const params: string[] = [];
      const paramCount = (fn % 4) + 1;
      for (let p = 0; p < paramCount; p++) {
        params.push(`param${p}: string`);
      }

      // Generate some function calls to other functions
      const callLines: string[] = [];
      for (let c = 0; c < CALLS_PER_FUNCTION; c++) {
        const targetFile = (f + c + 1) % FILE_COUNT;
        const targetFn = (fn + c) % FUNCTIONS_PER_FILE;
        const targetName = `func_${targetFile}_${targetFn}`;
        // Only call within the same file to avoid import complexity
        if (targetFile === f) {
          callLines.push(`  ${targetName}(${params.map((_, i) => `"arg${i}"`).join(', ')});`);
        }
      }

      // Make some params unused
      const bodyParams = params.slice(0, Math.max(1, paramCount - 1));
      const usedParamRefs = bodyParams.map((p, i) => `param${i}`).join(' + " " + ');

      code += `export function ${funcName}(${params.join(', ')}): string {\n`;
      if (callLines.length > 0) {
        code += callLines.join('\n') + '\n';
      }
      code += `  return ${usedParamRefs || '"result"'};\n`;
      code += `}\n\n`;
    }

    writeFileSync(resolve(SRC_DIR, `module_${f}.ts`), code);
  }

  // Write tsconfig
  writeFileSync(resolve(PERF_FIXTURE_PATH, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'Node16',
      moduleResolution: 'Node16',
      strict: true,
      esModuleInterop: true,
      outDir: './dist',
      rootDir: '.',
    },
    include: ['src/**/*.ts'],
  }, null, 2));
}

describe('Performance — Large Codebase', () => {
  beforeAll(() => {
    generateFixture();
  });

  afterAll(() => {
    // Clean up generated fixture
    if (existsSync(PERF_FIXTURE_PATH)) {
      rmSync(PERF_FIXTURE_PATH, { recursive: true });
    }
  });

  it(`should analyze ${FILE_COUNT * FUNCTIONS_PER_FILE} functions within time target`, async () => {
    const config: ResolvedConfig = {
      language: 'typescript',
      include: ['src/**/*.ts'],
      exclude: [],
      entryPoints: [],
      output: './codegraph-output.json',
      typescript: { tsconfig: './tsconfig.json' },
      projectRoot: PERF_FIXTURE_PATH,
    };

    const analyzer = new TypeScriptAnalyzer(config);

    const start = Date.now();
    const result = await analyzer.analyze();
    const elapsed = Date.now() - start;

    console.log(`  Performance: ${result.nodes.length} functions, ${result.edges.length} edges in ${elapsed}ms`);
    console.log(`  Files: ${result.files}, Rate: ${Math.round(result.nodes.length / (elapsed / 1000))} functions/sec`);

    // PRD target: 1k files, ~50k LOC should be under 10 seconds
    // Our 50 files with 1000 functions is a smaller test, should be well under
    expect(result.nodes.length).toBeGreaterThanOrEqual(FILE_COUNT * FUNCTIONS_PER_FILE);
    expect(result.files).toBe(FILE_COUNT);
    expect(elapsed).toBeLessThan(30000); // 30 seconds max for 1000 functions
  }, 60000);

  it('should detect unused parameters across all functions', async () => {
    const config: ResolvedConfig = {
      language: 'typescript',
      include: ['src/**/*.ts'],
      exclude: [],
      entryPoints: [],
      output: './codegraph-output.json',
      typescript: { tsconfig: './tsconfig.json' },
      projectRoot: PERF_FIXTURE_PATH,
    };

    const analyzer = new TypeScriptAnalyzer(config);
    const result = await analyzer.analyze();

    // Some functions have unused parameters by design
    const withUnused = result.nodes.filter(n => n.unusedParameters.length > 0);
    expect(withUnused.length).toBeGreaterThan(0);

    // Check accuracy — every function with >1 param should have at least one unused
    // (because we only use params 0..n-2 in the body)
    const multiParamFunctions = result.nodes.filter(n => n.parameters.length > 1);
    const multiParamUnused = multiParamFunctions.filter(n => n.unusedParameters.length > 0);
    const accuracy = multiParamUnused.length / multiParamFunctions.length;

    console.log(`  Unused param accuracy: ${(accuracy * 100).toFixed(1)}% (${multiParamUnused.length}/${multiParamFunctions.length})`);
    expect(accuracy).toBeGreaterThan(0.9); // > 90% accuracy (PRD target: 95%)
  }, 60000);
});
