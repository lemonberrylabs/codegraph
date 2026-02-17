import type { GraphNode, GraphEdge } from '../../analyzer/types.js';
import { GraphStore, NodeIndex } from '../data/graph-store.js';
import { setHighlightMode, clearHighlightMode } from './highlight.js';

const sidePanel = document.getElementById('side-panel')!;
const panelTitle = document.getElementById('panel-title')!;
const panelBody = document.getElementById('panel-body')!;
const panelClose = document.getElementById('panel-close')!;

export type NavigateToNodeCallback = (nodeId: string) => void;

let onNavigate: NavigateToNodeCallback | null = null;

panelClose.addEventListener('click', () => {
  closePanel();
});

export function setNavigateCallback(cb: NavigateToNodeCallback): void {
  onNavigate = cb;
}

export function openPanel(): void {
  sidePanel.classList.add('open');
}

export function closePanel(): void {
  sidePanel.classList.remove('open');
}

export function isPanelOpen(): boolean {
  return sidePanel.classList.contains('open');
}

export function showNodeDetails(nodeIdx: NodeIndex, store: GraphStore): void {
  const node = nodeIdx.node;
  panelTitle.textContent = 'Node Details';

  const incomingEdges = store.getIncomingEdges(node.id);
  const outgoingEdges = store.getOutgoingEdges(node.id);

  const statusClass = node.status === 'dead' ? 'dead' : node.status === 'entry' ? 'entry' : 'live';
  const statusLabel = node.status === 'dead' ? 'DEAD' :
    node.status === 'entry' ? 'ENTRY POINT' : 'LIVE';

  panelBody.innerHTML = `
    <div class="panel-section">
      <h3>Function Info</h3>
      <div class="panel-field">
        <span class="label">Name</span>
        <span class="value">${escapeHtml(node.name)}</span>
      </div>
      <div class="panel-field">
        <span class="label">File</span>
        <span class="value" style="font-size:12px">${escapeHtml(node.filePath)}:${node.startLine}</span>
      </div>
      <div class="panel-field">
        <span class="label">Package</span>
        <span class="value">${escapeHtml(node.packageOrModule)}</span>
      </div>
      <div class="panel-field">
        <span class="label">Kind</span>
        <span class="value">${node.kind}</span>
      </div>
      <div class="panel-field">
        <span class="label">Visibility</span>
        <span class="value">${node.visibility}</span>
      </div>
      <div class="panel-field">
        <span class="label">Lines of Code</span>
        <span class="value">${node.linesOfCode}</span>
      </div>
      <div class="panel-field">
        <span class="label">Status</span>
        <span class="status-badge ${statusClass}">${statusLabel}</span>
      </div>
    </div>

    <div class="panel-section">
      <h3>Parameters (${node.parameters.length})</h3>
      ${node.parameters.length > 0 ? `
        <ul class="param-list">
          ${node.parameters.map(p => `
            <li>
              <span class="${p.isUsed ? 'param-used' : 'param-unused'}">${p.isUsed ? '✓' : '⚠'}</span>
              <span>${escapeHtml(p.name)}${p.type ? ': <span style="color:var(--text-muted)">' + escapeHtml(p.type) + '</span>' : ''}</span>
              ${!p.isUsed ? '<span style="color:var(--yellow);font-size:11px">(UNUSED)</span>' : ''}
            </li>
          `).join('')}
        </ul>
      ` : '<p style="color:var(--text-muted);font-size:13px">No parameters</p>'}
    </div>

    <div class="panel-section">
      <h3>Called by (${incomingEdges.length})</h3>
      ${incomingEdges.length > 0 ? `
        <ul class="call-list">
          ${incomingEdges.map(edge => {
            const sourceNode = store.getNodeById(edge.source);
            return sourceNode ? `
              <li data-node-id="${escapeHtml(edge.source)}">
                → ${escapeHtml(sourceNode.node.name)}
                <span class="file-ref">${escapeHtml(edge.callSite.filePath)}:${edge.callSite.line}</span>
              </li>
            ` : '';
          }).join('')}
        </ul>
      ` : '<p style="color:var(--text-muted);font-size:13px">No callers</p>'}
    </div>

    <div class="panel-section">
      <h3>Calls (${outgoingEdges.length})</h3>
      ${outgoingEdges.length > 0 ? `
        <ul class="call-list">
          ${outgoingEdges.map(edge => {
            const targetNode = store.getNodeById(edge.target);
            return targetNode ? `
              <li data-node-id="${escapeHtml(edge.target)}">
                → ${escapeHtml(targetNode.node.name)}
                <span class="file-ref">${escapeHtml(targetNode.node.filePath)}:${targetNode.node.startLine}</span>
              </li>
            ` : '';
          }).join('')}
        </ul>
      ` : '<p style="color:var(--text-muted);font-size:13px">No calls</p>'}
    </div>

    <div class="panel-section">
      <h3>Highlight</h3>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="toolbar-btn" id="btn-hl-reachable" style="flex:1;font-size:12px">Reachable From</button>
        <button class="toolbar-btn" id="btn-hl-dependents" style="flex:1;font-size:12px">Dependents Of</button>
      </div>
      <button class="toolbar-btn" id="btn-hl-clear" style="width:100%;font-size:12px">Clear Highlight</button>
    </div>

    <div class="panel-section" style="display:flex;gap:8px">
      <button class="toolbar-btn" id="btn-view-source" style="flex:1">View Source</button>
      <button class="toolbar-btn" id="btn-copy-id" style="flex:1">Copy ID</button>
    </div>
  `;

  // Add click handlers to call list items
  panelBody.querySelectorAll('.call-list li[data-node-id]').forEach(li => {
    li.addEventListener('click', () => {
      const nodeId = li.getAttribute('data-node-id');
      if (nodeId) onNavigate?.(nodeId);
    });
  });

  // View Source button — tries to open in editor via server API, falls back to clipboard
  panelBody.querySelector('#btn-view-source')?.addEventListener('click', async () => {
    const location = `${node.filePath}:${node.startLine}`;
    try {
      const res = await fetch(`/api/open-source?file=${encodeURIComponent(node.filePath)}&line=${node.startLine}`);
      if (!res.ok) throw new Error('Server cannot open editor');
    } catch {
      // Fallback: copy file path to clipboard
      await navigator.clipboard.writeText(location);
      const btn = panelBody.querySelector('#btn-view-source') as HTMLButtonElement;
      if (btn) {
        const original = btn.textContent;
        btn.textContent = 'Copied path!';
        setTimeout(() => { btn.textContent = original; }, 1500);
      }
    }
  });

  // Copy ID button
  panelBody.querySelector('#btn-copy-id')?.addEventListener('click', () => {
    navigator.clipboard.writeText(node.id);
  });

  // Highlight buttons
  panelBody.querySelector('#btn-hl-reachable')?.addEventListener('click', () => {
    setHighlightMode({ mode: 'reachable-from', nodeId: node.id });
    document.getElementById('btn-highlight')?.classList.add('active');
  });
  panelBody.querySelector('#btn-hl-dependents')?.addEventListener('click', () => {
    setHighlightMode({ mode: 'reachable-to', nodeId: node.id });
    document.getElementById('btn-highlight')?.classList.add('active');
  });
  panelBody.querySelector('#btn-hl-clear')?.addEventListener('click', () => {
    clearHighlightMode();
    document.getElementById('btn-highlight')?.classList.remove('active');
  });

  openPanel();
}

export function showOverview(store: GraphStore): void {
  const graph = store.graph;
  const stats = graph.stats;
  const meta = graph.metadata;

  panelTitle.textContent = 'CodeGraph Overview';

  panelBody.innerHTML = `
    <div class="panel-section">
      <h3>Project</h3>
      <div class="panel-field">
        <span class="label">Language</span>
        <span class="value">${meta.language}</span>
      </div>
      <div class="panel-field">
        <span class="label">Files Analyzed</span>
        <span class="value">${meta.totalFiles}</span>
      </div>
      <div class="panel-field">
        <span class="label">Functions</span>
        <span class="value">${meta.totalFunctions.toLocaleString()}</span>
      </div>
      <div class="panel-field">
        <span class="label">Calls</span>
        <span class="value">${meta.totalEdges.toLocaleString()}</span>
      </div>
      <div class="panel-field">
        <span class="label">Analysis Time</span>
        <span class="value">${meta.analysisTimeMs}ms</span>
      </div>
    </div>

    <div class="panel-section">
      <h3>Status Summary</h3>
      <div class="panel-field">
        <span class="label" style="color:var(--red)">● Dead Functions</span>
        <span class="value">${stats.deadFunctions.count} (${stats.deadFunctions.percentage}%)</span>
      </div>
      <div class="panel-field">
        <span class="label" style="color:var(--yellow)">● Unused Parameters</span>
        <span class="value">${stats.unusedParameters.count} (${stats.unusedParameters.percentage}%)</span>
      </div>
      <div class="panel-field">
        <span class="label" style="color:var(--blue)">● Entry Points</span>
        <span class="value">${stats.entryPoints.count}</span>
      </div>
    </div>

    ${Object.keys(stats.deadFunctions.byPackage).length > 0 ? `
      <div class="panel-section">
        <h3>Dead Code by Package</h3>
        ${Object.entries(stats.deadFunctions.byPackage)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([pkg, count]) => {
            const pct = Math.round((count / stats.deadFunctions.count) * 100);
            return `
              <div class="panel-field">
                <span class="label" style="font-size:12px">${escapeHtml(pkg)}</span>
                <span class="value" style="color:var(--red)">${count}</span>
              </div>
            `;
          }).join('')}
      </div>
    ` : ''}

    ${stats.largestFunctions.length > 0 ? `
      <div class="panel-section">
        <h3>Largest Functions</h3>
        ${stats.largestFunctions.slice(0, 5).map(f => `
          <div class="panel-field">
            <span class="label" style="font-size:12px">${escapeHtml(f.id.split(':').pop() || f.id)}</span>
            <span class="value">${f.linesOfCode} LOC</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  openPanel();
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
