import Fuse from 'fuse.js';
import type { GraphNode } from '../../analyzer/types.js';
import { GraphStore } from '../data/graph-store.js';

const searchOverlay = document.getElementById('search-overlay')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const searchResults = document.getElementById('search-results')!;

let fuse: Fuse<GraphNode> | null = null;
let onSelectResult: ((nodeId: string) => void) | null = null;

export function initSearch(store: GraphStore, onSelect: (nodeId: string) => void): void {
  onSelectResult = onSelect;

  // Build Fuse.js index
  fuse = new Fuse(store.nodes, {
    keys: [
      { name: 'name', weight: 3 },
      { name: 'filePath', weight: 1 },
      { name: 'qualifiedName', weight: 2 },
      { name: 'parameters.name', weight: 0.5 },
    ],
    threshold: 0.4,
    includeScore: true,
    limit: 20,
  });

  searchInput.addEventListener('input', onSearchInput);
  searchInput.addEventListener('keydown', onSearchKeydown);
}

let selectedResultIndex = 0;

function onSearchInput(): void {
  const query = searchInput.value.trim();
  if (!query || !fuse) {
    searchResults.innerHTML = '';
    return;
  }

  const results = fuse.search(query);
  selectedResultIndex = 0;

  searchResults.innerHTML = results.map((r, i) => {
    const node = r.item;
    const statusColor =
      node.color === 'red' ? 'var(--red)' :
      node.color === 'yellow' ? 'var(--yellow)' :
      node.color === 'orange' ? 'var(--orange)' :
      node.color === 'blue' ? 'var(--blue)' :
      'var(--green)';

    return `
      <div class="search-result${i === 0 ? ' selected' : ''}" data-node-id="${node.id}" data-index="${i}">
        <div class="search-result-name">
          <span class="status-dot" style="background:${statusColor}"></span>
          ${escapeHtml(node.name)}
        </div>
        <div class="search-result-path">${escapeHtml(node.filePath)}:${node.startLine}</div>
      </div>
    `;
  }).join('');

  // Add click handlers
  searchResults.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      const nodeId = el.getAttribute('data-node-id');
      if (nodeId) {
        onSelectResult?.(nodeId);
        hideSearch();
      }
    });
  });
}

function onSearchKeydown(e: KeyboardEvent): void {
  const items = searchResults.querySelectorAll('.search-result');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedResultIndex = Math.min(selectedResultIndex + 1, items.length - 1);
    updateSelectedResult(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedResultIndex = Math.max(selectedResultIndex - 1, 0);
    updateSelectedResult(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const selected = items[selectedResultIndex] as HTMLElement;
    if (selected) {
      const nodeId = selected.getAttribute('data-node-id');
      if (nodeId) {
        onSelectResult?.(nodeId);
        hideSearch();
      }
    }
  } else if (e.key === 'Escape') {
    hideSearch();
  }
}

function updateSelectedResult(items: NodeListOf<Element>): void {
  items.forEach((el, i) => {
    if (i === selectedResultIndex) {
      el.classList.add('selected');
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.classList.remove('selected');
    }
  });
}

export function showSearch(): void {
  searchOverlay.classList.add('visible');
  searchInput.value = '';
  searchResults.innerHTML = '';
  searchInput.focus();
}

export function hideSearch(): void {
  searchOverlay.classList.remove('visible');
  searchInput.value = '';
  searchResults.innerHTML = '';
}

export function isSearchVisible(): boolean {
  return searchOverlay.classList.contains('visible');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
