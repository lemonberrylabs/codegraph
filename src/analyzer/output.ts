import { writeFileSync } from 'node:fs';
import type { CodeGraph } from './types.js';

/** Write the graph to a JSON file */
export function writeOutput(graph: CodeGraph, outputPath: string): void {
  const json = JSON.stringify(graph, null, 2);
  writeFileSync(outputPath, json, 'utf-8');
}

/** Serialize graph to JSON string */
export function serializeGraph(graph: CodeGraph): string {
  return JSON.stringify(graph);
}
