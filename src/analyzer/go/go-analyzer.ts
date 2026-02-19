import { spawn, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
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

export class GoAnalyzer extends BaseAnalyzer {
  async analyze(): Promise<AnalyzerResult> {
    const files = await this.resolveFiles();

    if (files.length === 0) {
      return { nodes: [], edges: [], files: 0 };
    }

    // Determine Go module name
    const moduleName = this.config.go?.module || this.detectGoModule();

    const helperDir = resolve(projectRoot, 'src', 'analyzer', 'go', 'go-helper');
    const helperBinary = await this.ensureGoHelper(helperDir);

    const input = JSON.stringify({
      files,
      projectRoot: this.config.projectRoot,
      module: moduleName,
    });

    const result = await this.runGoHelper(helperBinary, input);
    const parsed = JSON.parse(result);

    // The Go helper's type-aware path uses `packages.Load("./...")`
    // which discovers ALL packages, ignoring our exclude patterns.
    // Filter output to only include nodes from files we resolved.
    const allowedFiles = new Set(files);

    const nodes: GraphNode[] = (parsed.nodes || [])
      .filter((n: any) => allowedFiles.has(n.filePath))
      .map((n: any) => ({
        ...n,
        language: 'go' as const,
      }));

    const nodeIds = new Set(nodes.map((n: GraphNode) => n.id));
    const edges = (parsed.edges || []).filter(
      (e: any) => nodeIds.has(e.source) && nodeIds.has(e.target)
    ) as GraphEdge[];

    return {
      nodes,
      edges,
      files: files.length,
    };
  }

  private detectGoModule(): string {
    const goModPath = resolve(this.config.projectRoot, 'go.mod');
    if (existsSync(goModPath)) {
      const content = readFileSync(goModPath, 'utf-8');
      const match = content.match(/^module\s+(.+)$/m);
      if (match) return match[1].trim();
    }
    return '';
  }

  private async ensureGoHelper(helperDir: string): Promise<string> {
    const binaryName = process.platform === 'win32' ? 'go-helper.exe' : 'go-helper';
    const binaryPath = resolve(helperDir, binaryName);

    // Check if helper binary exists
    if (existsSync(binaryPath)) {
      return binaryPath;
    }

    // Try to build it
    console.log('Building Go helper binary...');
    try {
      execSync('go build -o ' + binaryName, {
        cwd: helperDir,
        stdio: 'pipe',
      });
      return binaryPath;
    } catch (err) {
      throw new Error(
        'Failed to build Go helper. Ensure the Go toolchain (1.24+) is installed.\n' +
        (err as Error).message
      );
    }
  }

  private runGoHelper(binaryPath: string, input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(binaryPath, [], {
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
          reject(new Error(`Go helper exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on('error', reject);

      proc.stdin.write(input);
      proc.stdin.end();
    });
  }
}
