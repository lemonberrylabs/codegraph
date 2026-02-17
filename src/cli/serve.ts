import express from 'express';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ResolvedConfig, CodeGraph } from '../analyzer/types.js';
import { runAnalysis } from '../analyzer/graph-builder.js';
import { startWatcher } from './watch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServeOptions {
  port: number;
  open: boolean;
  watch: boolean;
}

/**
 * Find the viewer directory. It could be in:
 * 1. dist/viewer/ (production build)
 * 2. src/viewer/ (dev — serve with Vite)
 */
function findViewerDir(): string {
  // When running from dist/src/cli/serve.js, viewer is at dist/viewer/
  const fromDist = resolve(__dirname, '..', '..', 'viewer');
  if (existsSync(resolve(fromDist, 'index.html'))) {
    return fromDist;
  }

  // When running from source, viewer is at src/viewer/
  const fromSrc = resolve(__dirname, '..', 'viewer');
  if (existsSync(resolve(fromSrc, 'index.html'))) {
    return fromSrc;
  }

  // Fallback: check relative to cwd
  const fromCwd = resolve(process.cwd(), 'dist', 'viewer');
  if (existsSync(resolve(fromCwd, 'index.html'))) {
    return fromCwd;
  }

  throw new Error(
    'Could not find viewer files. Run `pnpm run build:viewer` first, or run from the project root.'
  );
}

export async function startServer(
  config: ResolvedConfig,
  options: ServeOptions
): Promise<void> {
  console.log(`Analyzing ${config.language} project...`);
  let graph = await runAnalysis(config);
  console.log(`Analysis complete: ${graph.metadata.totalFunctions} functions, ${graph.metadata.totalEdges} edges`);

  const app = express();
  const server = createServer(app);

  // WebSocket server for live updates
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  // API endpoint for graph data
  app.get('/api/graph', (_req, res) => {
    res.json(graph);
  });

  // API endpoint to open source file in editor
  app.get('/api/open-source', (req, res) => {
    const file = req.query.file as string;
    const line = req.query.line as string;
    if (!file) {
      res.status(400).json({ error: 'Missing file parameter' });
      return;
    }

    const absPath = resolve(config.projectRoot, file);

    // Prevent path traversal — ensure resolved path stays within project root
    if (!absPath.startsWith(config.projectRoot + '/') && absPath !== config.projectRoot) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    if (!existsSync(absPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const location = line ? `${absPath}:${line}` : absPath;

    try {
      // Try VS Code first (use spawnSync with args array to prevent injection)
      const result = spawnSync('code', ['--goto', location], { stdio: 'pipe', timeout: 3000 });
      if (result.status === 0) {
        res.json({ opened: true, editor: 'vscode' });
        return;
      }
    } catch {
      // Fall through to $EDITOR
    }

    // Try $EDITOR
    const editor = process.env.EDITOR;
    if (editor) {
      try {
        const result = spawnSync(editor, [absPath], { stdio: 'pipe', timeout: 3000 });
        if (result.status === 0) {
          res.json({ opened: true, editor });
          return;
        }
      } catch {
        // Fall through
      }
    }

    res.status(500).json({ error: 'No editor available (set $EDITOR or install VS Code)' });
  });

  // Serve the viewer (static files)
  const viewerDir = findViewerDir();
  app.use(express.static(viewerDir));

  // Fallback to index.html for SPA routing
  app.get('*', (_req, res) => {
    res.sendFile(resolve(viewerDir, 'index.html'));
  });

  // Start server
  server.listen(options.port, () => {
    const url = `http://localhost:${options.port}`;
    console.log(`\nCodeGraph viewer running at ${url}`);
    console.log(`  Functions: ${graph.metadata.totalFunctions}`);
    console.log(`  Dead functions: ${graph.metadata.totalDeadFunctions}`);
    console.log(`  Unused parameters: ${graph.metadata.totalUnusedParameters}`);
    console.log(`  Viewer: ${viewerDir}`);

    if (options.watch) {
      console.log(`  Watch mode: enabled`);
    }

    if (options.open) {
      import('open').then(({ default: open }) => {
        open(url);
      }).catch(() => {
        console.log(`  Open ${url} in your browser`);
      });
    }
  });

  // Watch mode
  if (options.watch) {
    startWatcher(config, (updatedGraph: CodeGraph) => {
      graph = updatedGraph;
      console.log(`[watch] Graph updated: ${graph.metadata.totalFunctions} functions`);

      // Broadcast to all connected WebSocket clients
      const message = JSON.stringify({
        type: 'graph-update',
        graph: updatedGraph,
      });

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    });
  }
}
