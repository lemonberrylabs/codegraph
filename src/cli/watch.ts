import { watch } from 'chokidar';
import { resolve, relative } from 'node:path';
import type { ResolvedConfig, CodeGraph, GraphNode, GraphEdge } from '../analyzer/types.js';
import { runAnalysis } from '../analyzer/graph-builder.js';

/**
 * Start watching source files for changes and re-analyze on change.
 *
 * On initial run, performs a full analysis. On subsequent file changes,
 * does a full re-analysis (incremental merging is handled at the graph
 * builder level — per-file node/edge tracking ensures only changed
 * functions are reprocessed).
 *
 * The re-analysis is debounced: multiple rapid file changes are batched
 * into a single re-analysis pass.
 */
export function startWatcher(
  config: ResolvedConfig,
  onUpdate: (graph: CodeGraph) => void
): void {
  // Build watch paths from include patterns
  const watchPaths = config.include.map(p => resolve(config.projectRoot, p));

  const watcher = watch(watchPaths, {
    cwd: config.projectRoot,
    ignored: config.exclude.map(p => resolve(config.projectRoot, p)),
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  let debounceTimer: NodeJS.Timeout | null = null;
  let analyzing = false;
  let pendingChanges = new Set<string>();

  const triggerAnalysis = (filePath: string, event: string) => {
    pendingChanges.add(filePath);

    if (analyzing) {
      // Clear any pending debounce timer to avoid double analysis
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      analyzing = true;
      const changedFiles = [...pendingChanges];
      pendingChanges.clear();

      try {
        console.log(`[watch] ${changedFiles.length} file(s) changed, re-analyzing...`);
        for (const f of changedFiles) {
          console.log(`[watch]   ${event}: ${f}`);
        }
        const start = Date.now();
        const graph = await runAnalysis(config);
        const elapsed = Date.now() - start;
        console.log(`[watch] Analysis complete in ${elapsed}ms (${graph.metadata.totalFunctions} functions)`);
        onUpdate(graph);
      } catch (err) {
        console.error('[watch] Analysis failed:', (err as Error).message);
      } finally {
        analyzing = false;

        // If more changes accumulated while analyzing, trigger again
        if (pendingChanges.size > 0) {
          triggerAnalysis([...pendingChanges][0], 'queued');
        }
      }
    }, 500);
  };

  watcher.on('change', (filePath) => {
    triggerAnalysis(String(filePath), 'changed');
  });

  watcher.on('add', (filePath) => {
    triggerAnalysis(String(filePath), 'added');
  });

  watcher.on('unlink', (filePath) => {
    triggerAnalysis(String(filePath), 'removed');
  });

  console.log('[watch] Watching for file changes...');
}
