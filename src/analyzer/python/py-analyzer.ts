import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BaseAnalyzer } from '../base-analyzer.js';
import type { AnalyzerResult, GraphNode, GraphEdge } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve project root (works from both src/ and dist/src/)
function findProjectRoot(): string {
  let dir = __dirname;
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return __dirname;
}
const projectRoot = findProjectRoot();

export class PythonAnalyzer extends BaseAnalyzer {
  async analyze(): Promise<AnalyzerResult> {
    const files = await this.resolveFiles();

    if (files.length === 0) {
      return { nodes: [], edges: [], files: 0 };
    }

    const helperScript = resolve(projectRoot, 'src', 'analyzer', 'python', 'py-helper', 'analyze.py');
    const input = JSON.stringify({
      files,
      projectRoot: this.config.projectRoot,
    });

    const result = await this.runPythonHelper(helperScript, input);
    const parsed = JSON.parse(result);

    // Convert to proper types
    const nodes: GraphNode[] = parsed.nodes.map((n: any) => ({
      ...n,
      language: 'python' as const,
    }));

    return {
      nodes,
      edges: parsed.edges as GraphEdge[],
      files: files.length,
    };
  }

  private runPythonHelper(scriptPath: string, input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Try python3 first, then python
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const proc = spawn(pythonCmd, [scriptPath], {
        cwd: this.config.projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python helper exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(
            'Python 3 is required for Python analysis but was not found. ' +
            'Please install Python 3.8+ and ensure it is on your PATH.'
          ));
        } else {
          reject(err);
        }
      });

      proc.stdin.write(input);
      proc.stdin.end();
    });
  }
}
