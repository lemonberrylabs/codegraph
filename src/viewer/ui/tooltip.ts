import type { GraphNode } from '../../analyzer/types.js';

const tooltip = document.getElementById('tooltip')!;
const tooltipName = document.getElementById('tooltip-name')!;
const tooltipPath = document.getElementById('tooltip-path')!;
const tooltipMeta = document.getElementById('tooltip-meta')!;

export function showTooltip(node: GraphNode, x: number, y: number): void {
  tooltipName.textContent = node.name;
  tooltipPath.textContent = `${node.filePath}:${node.startLine}`;

  const statusText = node.status === 'dead' ? 'DEAD' : node.status === 'entry' ? 'ENTRY POINT' : 'LIVE';
  const paramInfo = node.unusedParameters.length > 0
    ? ` | ${node.unusedParameters.length} unused param(s)`
    : '';

  tooltipMeta.textContent = `${statusText} | ${node.kind} | ${node.linesOfCode} LOC${paramInfo}`;

  // Position tooltip near the cursor
  const padding = 12;
  tooltip.style.left = `${x + padding}px`;
  tooltip.style.top = `${y + padding}px`;

  // Ensure tooltip stays within viewport
  const rect = tooltip.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    tooltip.style.left = `${x - rect.width - padding}px`;
  }
  if (rect.bottom > window.innerHeight) {
    tooltip.style.top = `${y - rect.height - padding}px`;
  }

  tooltip.classList.add('visible');
}

export function hideTooltip(): void {
  tooltip.classList.remove('visible');
}
