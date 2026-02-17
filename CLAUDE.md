# CodeGraph — Project Instructions

## Package Manager

Always use **pnpm** (not npm or yarn) for all package management operations.

## Project Overview

CodeGraph is a local-first developer tool that performs static analysis on codebases (TypeScript, Go, Python), builds function-level call graphs, and renders them as interactive 3D visualizations. It detects dead code and unused parameters.

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm run build:cli    # Build CLI
pnpm run dev:viewer   # Dev server for viewer
pnpm run test         # Run tests
pnpm run typecheck    # Type checking
```

## Architecture

- **CLI**: TypeScript (Node.js), uses commander.js
- **TypeScript Analyzer**: Uses TypeScript Compiler API
- **Go Analyzer**: Go helper binary in `src/analyzer/go/go-helper/`
- **Python Analyzer**: Python helper script in `src/analyzer/python/py-helper/`
- **Web Viewer**: Three.js + Vite, force-directed layout in Web Worker
