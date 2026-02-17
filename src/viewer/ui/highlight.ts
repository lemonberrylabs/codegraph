import type { GraphStore } from '../data/graph-store.js';
import type { NodeRenderer } from '../scene/node-renderer.js';
import type { EdgeRenderer } from '../scene/edge-renderer.js';

export type HighlightMode = 'none' | 'dead' | 'unused-params' | 'package' | 'reachable-from' | 'reachable-to';

export interface HighlightState {
  mode: HighlightMode;
  /** Package name for 'package' mode */
  packageName?: string;
  /** Node ID for reachability modes */
  nodeId?: string;
}

let store: GraphStore;
let nodeRenderer: NodeRenderer;
let edgeRenderer: EdgeRenderer;
let currentState: HighlightState = { mode: 'none' };
let highlightMenuEl: HTMLElement | null = null;

export function initHighlight(
  graphStore: GraphStore,
  nr: NodeRenderer,
  er: EdgeRenderer,
): void {
  store = graphStore;
  nodeRenderer = nr;
  edgeRenderer = er;
  buildHighlightMenu();
}

export function setHighlightMode(state: HighlightState): void {
  currentState = state;
  applyHighlight();
  updateHighlightMenuUI();
}

export function getHighlightMode(): HighlightMode {
  return currentState.mode;
}

export function clearHighlightMode(): void {
  currentState = { mode: 'none' };
  nodeRenderer.clearHighlights();
  edgeRenderer.resetColors();
  updateHighlightMenuUI();
}

function applyHighlight(): void {
  if (currentState.mode === 'none') {
    nodeRenderer.clearHighlights();
    edgeRenderer.resetColors();
    return;
  }

  const indices = new Set<number>();

  switch (currentState.mode) {
    case 'dead':
      for (let i = 0; i < store.nodeCount; i++) {
        const node = store.nodes[i];
        if (node.status === 'dead') indices.add(i);
      }
      break;

    case 'unused-params':
      for (let i = 0; i < store.nodeCount; i++) {
        const node = store.nodes[i];
        if (node.unusedParameters.length > 0) indices.add(i);
      }
      break;

    case 'package':
      if (currentState.packageName) {
        for (let i = 0; i < store.nodeCount; i++) {
          const node = store.nodes[i];
          if (node.packageOrModule === currentState.packageName) indices.add(i);
        }
      }
      break;

    case 'reachable-from':
      if (currentState.nodeId) {
        const reachable = store.getReachableFrom(currentState.nodeId);
        for (const id of reachable) {
          const nodeIdx = store.getNodeById(id);
          if (nodeIdx) indices.add(nodeIdx.index);
        }
      }
      break;

    case 'reachable-to':
      if (currentState.nodeId) {
        const reachable = store.getReachableTo(currentState.nodeId);
        for (const id of reachable) {
          const nodeIdx = store.getNodeById(id);
          if (nodeIdx) indices.add(nodeIdx.index);
        }
      }
      break;
  }

  nodeRenderer.setHighlighted(indices);
}

function buildHighlightMenu(): void {
  highlightMenuEl = document.getElementById('highlight-menu');
  if (!highlightMenuEl) return;

  // Collect unique packages
  const allPackages = new Set<string>();
  for (const node of store.nodes) {
    allPackages.add(node.packageOrModule);
  }

  highlightMenuEl.innerHTML = `
    <button class="toolbar-btn highlight-opt" data-highlight="none" style="width:100%;text-align:left">None (show all equally)</button>
    <button class="toolbar-btn highlight-opt" data-highlight="dead" style="width:100%;text-align:left">
      <span style="color:var(--red)">●</span> Dead Code
    </button>
    <button class="toolbar-btn highlight-opt" data-highlight="unused-params" style="width:100%;text-align:left">
      <span style="color:var(--yellow)">●</span> Unused Parameters
    </button>
    <div style="border-top:1px solid var(--border);margin:4px 0;"></div>
    <div style="font-size:11px;color:var(--text-muted);padding:4px 12px;text-transform:uppercase;letter-spacing:1px;">By Package</div>
    ${[...allPackages].sort().map(p =>
      `<button class="toolbar-btn highlight-opt" data-highlight="package" data-package="${p}" style="width:100%;text-align:left;font-size:12px">${p}</button>`
    ).join('\n')}
  `;

  // Attach click handlers
  highlightMenuEl.querySelectorAll<HTMLElement>('.highlight-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-highlight') as HighlightMode;
      if (mode === 'package') {
        const pkg = btn.getAttribute('data-package')!;
        setHighlightMode({ mode: 'package', packageName: pkg });
      } else {
        setHighlightMode({ mode });
      }
      highlightMenuEl!.style.display = 'none';
      document.getElementById('btn-highlight')?.classList.toggle('active', mode !== 'none');
    });
  });
}

function updateHighlightMenuUI(): void {
  if (!highlightMenuEl) return;
  highlightMenuEl.querySelectorAll<HTMLElement>('.highlight-opt').forEach(btn => {
    const mode = btn.getAttribute('data-highlight');
    let isActive = false;
    if (mode === currentState.mode) {
      if (mode === 'package') {
        isActive = btn.getAttribute('data-package') === currentState.packageName;
      } else {
        isActive = true;
      }
    }
    btn.classList.toggle('active', isActive);
  });
}

export function toggleHighlightMenu(): void {
  if (!highlightMenuEl) return;
  highlightMenuEl.style.display = highlightMenuEl.style.display === 'none' ? 'block' : 'none';
}

export function isHighlightMenuOpen(): boolean {
  return highlightMenuEl?.style.display !== 'none';
}
