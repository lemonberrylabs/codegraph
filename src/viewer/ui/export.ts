import type { GraphStore } from '../data/graph-store.js';
import type { GraphScene } from '../scene/graph-scene.js';

/**
 * Export functionality for the viewer.
 */

/** Export a PNG screenshot of the current viewport */
export function exportScreenshot(scene: GraphScene): void {
  const dataUrl = scene.screenshot();
  downloadDataUrl(dataUrl, 'codegraph-screenshot.png');
}

/** Export a JSON dead code report */
export function exportDeadCodeJSON(store: GraphStore): void {
  const deadNodes = store.nodes.filter(n => n.status === 'dead');
  const report = {
    generatedAt: new Date().toISOString(),
    totalFunctions: store.nodeCount,
    deadFunctions: deadNodes.length,
    percentage: store.nodeCount > 0
      ? Math.round((deadNodes.length / store.nodeCount) * 10000) / 100
      : 0,
    functions: deadNodes.map(n => ({
      name: n.name,
      qualifiedName: n.qualifiedName,
      filePath: n.filePath,
      startLine: n.startLine,
      endLine: n.endLine,
      linesOfCode: n.linesOfCode,
      unusedParameters: n.unusedParameters,
    })),
  };

  const json = JSON.stringify(report, null, 2);
  downloadBlob(json, 'codegraph-dead-code.json', 'application/json');
}

/** Export a CSV dead code report */
export function exportDeadCodeCSV(store: GraphStore): void {
  const deadNodes = store.nodes.filter(n => n.status === 'dead');
  const unusedParamNodes = store.nodes.filter(n => n.unusedParameters.length > 0);

  const rows = [
    ['Type', 'Name', 'File', 'Line', 'LOC', 'Unused Params'].join(','),
  ];

  for (const n of deadNodes) {
    rows.push([
      'dead',
      csvEscape(n.name),
      csvEscape(n.filePath),
      String(n.startLine),
      String(n.linesOfCode),
      csvEscape(n.unusedParameters.join('; ')),
    ].join(','));
  }

  for (const n of unusedParamNodes) {
    if (n.status !== 'dead') {
      rows.push([
        'unused-params',
        csvEscape(n.name),
        csvEscape(n.filePath),
        String(n.startLine),
        String(n.linesOfCode),
        csvEscape(n.unusedParameters.join('; ')),
      ].join(','));
    }
  }

  downloadBlob(rows.join('\n'), 'codegraph-report.csv', 'text/csv');
}

/** Export a Markdown report */
export function exportMarkdownReport(store: GraphStore): void {
  const graph = store.graph;
  const stats = graph.stats;
  const deadNodes = store.nodes.filter(n => n.status === 'dead');
  const unusedParamNodes = store.nodes.filter(n => n.unusedParameters.length > 0);

  let md = `# CodeGraph Analysis Report\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n`;
  md += `**Language:** ${graph.metadata.language}\n`;
  md += `**Files:** ${graph.metadata.totalFiles}\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total Functions | ${graph.metadata.totalFunctions} |\n`;
  md += `| Total Calls | ${graph.metadata.totalEdges} |\n`;
  md += `| Dead Functions | ${stats.deadFunctions.count} (${stats.deadFunctions.percentage}%) |\n`;
  md += `| Unused Parameters | ${stats.unusedParameters.count} (${stats.unusedParameters.percentage}%) |\n`;
  md += `| Entry Points | ${stats.entryPoints.count} |\n`;
  md += `| Analysis Time | ${graph.metadata.analysisTimeMs}ms |\n\n`;

  if (deadNodes.length > 0) {
    md += `## Dead Functions (${deadNodes.length})\n\n`;
    md += `| Function | File | Line | LOC |\n|----------|------|------|-----|\n`;
    for (const n of deadNodes) {
      md += `| \`${n.name}\` | ${n.filePath} | ${n.startLine} | ${n.linesOfCode} |\n`;
    }
    md += `\n`;
  }

  if (unusedParamNodes.length > 0) {
    md += `## Functions with Unused Parameters (${unusedParamNodes.length})\n\n`;
    md += `| Function | File | Line | Unused Params |\n|----------|------|------|---------------|\n`;
    for (const n of unusedParamNodes) {
      md += `| \`${n.name}\` | ${n.filePath} | ${n.startLine} | ${n.unusedParameters.join(', ')} |\n`;
    }
    md += `\n`;
  }

  if (Object.keys(stats.deadFunctions.byPackage).length > 0) {
    md += `## Dead Code by Package\n\n`;
    md += `| Package | Dead Functions |\n|---------|----------------|\n`;
    const sorted = Object.entries(stats.deadFunctions.byPackage).sort(([, a], [, b]) => b - a);
    for (const [pkg, count] of sorted) {
      md += `| ${pkg} | ${count} |\n`;
    }
    md += `\n`;
  }

  downloadBlob(md, 'codegraph-report.md', 'text/markdown');
}

function csvEscape(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  URL.revokeObjectURL(url);
}

function downloadDataUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
