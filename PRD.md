# CodeGraph — Codebase Call-Graph Visualizer

## Product Requirements Document (PRD)

**Version:** 1.0
**Last Updated:** 2026-02-16

---

## 1. Executive Summary

CodeGraph is a local-first developer tool that performs static analysis on codebases written in TypeScript, Go, and Python, builds a complete function-level call graph, and renders it as an interactive 3D visualization in the browser. It highlights dead code (functions with no callers) and functions with unused parameters, enabling developers to quickly identify code quality issues across large codebases. Users can declare entry points (e.g., API handlers, CLI commands, main functions) so that externally-invoked functions are not falsely flagged as dead code.

The tool consists of two components:

1. **CLI Analyzer** — Parses source code, performs static analysis, and outputs a standardized JSON graph file.
2. **Web Viewer** — A local web application that renders the JSON graph as an interactive 3D force-directed graph using Three.js, optimized for thousands of nodes.

---

## 2. Goals and Non-Goals

### 2.1 Goals

- Accurately build function-level call graphs for TypeScript, Go, and Python codebases.
- Detect and flag functions with zero incoming edges (dead code) via red coloring.
- Detect and flag functions with one or more unused parameters via yellow coloring.
- Allow users to declare entry points so externally-invoked functions are not flagged as dead code.
- Render the call graph as a performant, interactive 3D visualization that handles thousands of nodes smoothly (60fps target).
- Run entirely locally — no network calls, no accounts, no telemetry.
- Produce a standardized intermediate JSON format that decouples analysis from visualization.

### 2.2 Non-Goals

- Dynamic/runtime analysis (profiling, tracing, coverage). This is purely static analysis.
- Cross-language call graph resolution (e.g., a Go service calling a Python service via HTTP). Each language is analyzed independently.
- Modifying or fixing the source code. This tool is read-only and diagnostic.
- IDE/editor integration (future scope).
- Remote/hosted deployment (future scope).
- Support for languages beyond TypeScript, Go, and Python in v1.

---

## 3. User Personas

### 3.1 Individual Developer
A developer working on a medium-to-large codebase who wants to identify dead code and unused parameters during refactoring, code review prep, or general codebase exploration.

### 3.2 Tech Lead / Architect
A technical leader who wants a high-level view of the codebase's function-level dependency structure to understand coupling, identify isolated subsystems, and plan refactoring efforts.

---

## 4. Configuration

### 4.1 Configuration File

CodeGraph uses a configuration file named `codegraph.config.json` (or `codegraph.config.yaml`) placed at the root of the target project. The CLI also accepts all configuration as command-line flags, with CLI flags taking precedence over the config file.

### 4.2 Configuration Schema

```jsonc
{
  // Language to analyze. Required.
  "language": "typescript" | "go" | "python",

  // Directories and files to include in analysis. Glob patterns supported.
  // Relative to the config file location.
  "include": [
    "src/**/*.ts",
    "lib/**/*.ts"
  ],

  // Directories and files to exclude from analysis. Glob patterns supported.
  "exclude": [
    "node_modules/**",
    "**/*.test.ts",
    "**/*.spec.ts",
    "dist/**",
    "vendor/**",
    "__pycache__/**",
    "**/*_test.go"
  ],

  // Entry points — functions that are externally invoked and should NOT be
  // flagged as dead code. These propagate: any function reachable from an
  // entry point through the call graph is considered "live."
  "entryPoints": [
    // By file glob — all exported functions in matched files are entry points.
    { "type": "file", "pattern": "src/routes/**/*.ts" },
    { "type": "file", "pattern": "cmd/**/*.go" },

    // By function name — specific fully-qualified function names.
    { "type": "function", "name": "main" },
    { "type": "function", "name": "src/server.ts:startServer" },

    // By decorator/annotation (Python/TypeScript) — functions with matching decorators.
    { "type": "decorator", "name": "app.route" },
    { "type": "decorator", "name": "@click.command" },

    // By export — all exported symbols from matched files.
    { "type": "export", "pattern": "src/index.ts" }
  ],

  // Output path for the generated JSON graph file.
  "output": "./codegraph-output.json",

  // TypeScript-specific options.
  "typescript": {
    // Path to tsconfig.json. If omitted, auto-detected from project root.
    "tsconfig": "./tsconfig.json"
  },

  // Go-specific options.
  "go": {
    // Module path. If omitted, read from go.mod.
    "module": "",
    // Build tags to include.
    "buildTags": []
  },

  // Python-specific options.
  "python": {
    // Python version to target for parsing (affects syntax support).
    "pythonVersion": "3.10",
    // Virtual environment path for resolving imports.
    "venvPath": "",
    // Additional source roots for import resolution.
    "sourceRoots": []
  }
}
```

---

## 5. CLI Analyzer

### 5.1 Overview

The CLI analyzer is a command-line tool that parses source code files, extracts function/method definitions and call sites, resolves calls to their targets, and outputs a JSON graph file. It is implemented as a single binary/executable with sub-commands per language.

### 5.2 Commands

```
codegraph analyze [options]           # Run analysis using config file
codegraph analyze --language ts       # Override language
codegraph analyze --include "src/**"  # Override include patterns
codegraph analyze --entry "src/routes/**/*.ts"  # Add entry points
codegraph analyze --output graph.json # Override output path
codegraph serve [options]             # Run analysis + start the web viewer
codegraph serve --port 8888           # Custom port
codegraph serve --open                # Auto-open browser
codegraph serve --watch               # Re-analyze on file changes
```

### 5.3 Implementation Language

The CLI should be implemented in **TypeScript (Node.js)** for the following reasons:

- TypeScript analysis requires the TypeScript compiler API, which is only available in JS/TS.
- Python AST parsing can be done via `tree-sitter` bindings available in Node.js, or by shelling out to a Python script that uses the `ast` module.
- Go analysis can be done via `tree-sitter` bindings in Node.js, or by shelling out to a Go helper binary that uses `go/packages` + `go/ast` + `go/types`.
- A single Node.js CLI keeps the install story simple (`npm install -g codegraph` or `npx codegraph`).

Alternatively, the Go analyzer component may be implemented as a separate Go binary that the CLI invokes, since Go's native tooling (`go/packages`, `golang.org/x/tools/go/callgraph`) is significantly more accurate than tree-sitter for Go analysis.

### 5.4 Static Analysis — What to Extract

For each source file, the analyzer must extract:

#### 5.4.1 Nodes (Functions/Methods)

Each node represents a callable unit. The following metadata must be captured per node:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier. Format: `<file_path>:<function_name>` for top-level functions, `<file_path>:<class_name>.<method_name>` for methods. |
| `name` | `string` | The short function/method name (e.g., `handleRequest`). |
| `qualifiedName` | `string` | Fully qualified name including module/package path. |
| `filePath` | `string` | Relative path from project root to the source file. |
| `startLine` | `number` | Line number where the function definition starts (1-indexed). |
| `endLine` | `number` | Line number where the function definition ends (1-indexed). |
| `language` | `"typescript" \| "go" \| "python"` | Source language. |
| `kind` | `"function" \| "method" \| "constructor" \| "arrow" \| "closure" \| "lambda"` | The kind of callable. |
| `visibility` | `"exported" \| "public" \| "private" \| "internal" \| "module"` | Visibility/access level. |
| `isEntryPoint` | `boolean` | Whether this function was marked as an entry point (directly or by matching a config rule). |
| `parameters` | `Parameter[]` | List of declared parameters (see below). |
| `unusedParameters` | `string[]` | Names of parameters not referenced in the function body. |
| `packageOrModule` | `string` | The package (Go), module (Python), or file/directory (TS) this function belongs to. Used for clustering. |
| `linesOfCode` | `number` | Number of lines in the function body (for sizing nodes in the visualization). |

**Parameter Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Parameter name. |
| `type` | `string \| null` | Type annotation if available (TS, Go, Python type hints). |
| `isUsed` | `boolean` | Whether this parameter is referenced anywhere in the function body. |
| `position` | `number` | 0-indexed position in the parameter list. |

#### 5.4.2 Edges (Call Sites)

Each edge represents one function calling another. The following metadata must be captured per edge:

| Field | Type | Description |
|-------|------|-------------|
| `source` | `string` | Node ID of the calling function. |
| `target` | `string` | Node ID of the called function. |
| `callSite` | `object` | `{ filePath, line, column }` — where the call occurs. |
| `kind` | `"direct" \| "method" \| "constructor" \| "callback" \| "dynamic"` | The nature of the call. |
| `isResolved` | `boolean` | Whether the target could be statically resolved. If false, it's a best-effort guess. |

### 5.5 Language-Specific Analysis Details

#### 5.5.1 TypeScript

**Parser:** Use the TypeScript Compiler API (`typescript` package) with the project's `tsconfig.json` to get full type resolution.

**What constitutes a "function" (node):**

- `function` declarations (named and default-exported)
- Arrow function expressions assigned to a `const`/`let`/`var` at module scope or as class properties
- Method declarations in classes and object literals
- Constructor declarations
- Getter and setter declarations (treat as methods)
- Functions exported from modules

**What constitutes a "call" (edge):**

- Direct function calls: `foo()`, `bar.baz()`
- Constructor calls: `new Foo()`
- Method calls: `obj.method()` — resolve via the type checker to determine which class/interface method is being called
- Calls via imported symbols: `import { foo } from './bar'; foo()` — resolve to the definition in `bar`
- Calls via destructured imports: `const { foo } = require('./bar'); foo()` — resolve similarly
- Higher-order function passing: `arr.map(processItem)` — if `processItem` is a known function, create an edge. Mark `kind` as `"callback"`.
- Chained calls: `foo().bar()` — create edges for both `foo` and the resolved `bar`

**What to skip/handle carefully:**

- Dynamic calls where the target cannot be statically determined (`obj[key]()`) — log these as unresolved edges with `isResolved: false`.
- Calls into `node_modules` / external dependencies — do NOT create nodes for external functions. Only create edges pointing to a sentinel node named `[external]` if desired, or simply skip them.
- Type-only imports (`import type { Foo }`) — skip, these are not runtime calls.
- Overloaded functions — create one node for the implementation, map all call signatures to it.

**Unused parameter detection:**

- For each function, walk the AST of the function body.
- Check if each parameter's symbol has any references (using the TypeScript type checker's `findAllReferences` or by walking the body AST and comparing symbol identities).
- Parameters prefixed with `_` should be ignored (conventional "intentionally unused" signal). This should be configurable.
- Destructured parameters: check if each destructured binding is used, not just the top-level parameter name.
- Rest parameters (`...args`): check if `args` is referenced.

#### 5.5.2 Go

**Parser:** Prefer using Go's native `go/packages`, `go/ast`, `go/types`, and `golang.org/x/tools/go/callgraph` packages via a Go helper binary. Fall back to `tree-sitter-go` if the Go toolchain is not available.

**What constitutes a "function" (node):**

- Package-level function declarations (`func Foo()`)
- Method declarations (`func (r *Receiver) Foo()`)
- Function literals (anonymous functions) assigned to package-level variables
- `init()` functions (mark as entry points automatically)
- `main()` functions in `package main` (mark as entry points automatically)

**What constitutes a "call" (edge):**

- Direct function calls: `foo()`, `pkg.Bar()`
- Method calls: `obj.Method()` — resolve through the type system to determine the receiver type
- Interface method calls: `iface.Method()` — resolve to all concrete implementations (create edges to all possible targets; mark all as `kind: "dynamic"`)
- Function value calls: `fn := getHandler; fn()` — best-effort resolution; mark as `kind: "dynamic"` if uncertain
- Goroutine invocations: `go foo()` — treat identically to `foo()` for call graph purposes
- Deferred calls: `defer foo()` — treat identically to `foo()` for call graph purposes

**What to skip:**

- Calls to standard library functions — do NOT create nodes for stdlib. Skip these edges.
- Calls to external dependencies (outside the module) — skip.
- Built-in functions (`make`, `len`, `append`, etc.) — skip.
- CGo calls — skip.

**Unused parameter detection:**

- Walk the function body AST and check if each parameter identifier is referenced.
- Parameters named `_` are intentionally unused and should be excluded from flagging.
- For method receivers, check if the receiver variable is used in the body (an unused receiver suggests the method could be a function).

**Go-specific entry point detection:**

- All `main()` functions in `package main` are automatic entry points.
- All `init()` functions are automatic entry points.
- All `Test*`, `Benchmark*`, and `Example*` functions in `*_test.go` files are automatic entry points (if test files are included in analysis).

#### 5.5.3 Python

**Parser:** Use Python's built-in `ast` module via a Python helper script, or `tree-sitter-python` in Node.js. For import resolution, use a combination of AST analysis and file-system crawling. Full type resolution is not feasible without a type checker like `mypy` or `pyright`, but basic name resolution should be attempted.

**What constitutes a "function" (node):**

- `def` function declarations at module scope
- `def` method declarations inside classes
- `async def` declarations (async functions/methods)
- `lambda` expressions assigned to module-scope variables (best-effort)
- Class declarations themselves can be nodes if `__init__` is defined (to track constructor calls)
- `@staticmethod` and `@classmethod` decorated methods
- `@property` getters/setters (treat as methods)

**What constitutes a "call" (edge):**

- Direct function calls: `foo()`, `module.bar()`
- Method calls: `obj.method()` — resolve through import analysis and class hierarchy (best-effort)
- Constructor calls: `Foo()` — resolve to `Foo.__init__` if it exists
- Decorator applications: `@decorator` on a function — create an edge from the decorated function to the decorator function
- Calls via imported symbols: `from module import foo; foo()` — resolve through the import chain
- `super().method()` calls — resolve to parent class method
- Comprehension and generator calls: `[f(x) for x in items]` — create edge to `f`

**What to skip:**

- Calls to built-in functions (`print`, `len`, `range`, etc.) — skip.
- Calls to standard library functions — skip.
- Calls to functions from external packages (not in the project source tree) — skip.
- Dynamic attribute access (`getattr(obj, name)()`) — log as unresolved.

**Unused parameter detection:**

- Walk the function body AST and check if each parameter name appears as a `Name` node in `Load` context.
- Parameters named `_` or prefixed with `_` are intentionally unused — exclude from flagging (configurable).
- `self` and `cls` parameters in methods — exclude from analysis (they are always implicitly used for method binding).
- `*args` and `**kwargs`: check if the variable name is referenced in the body.
- Default parameter values: the parameter is still unused if only the default is used and the parameter name never appears in the body.

**Python-specific entry point detection:**

- Files with `if __name__ == "__main__":` blocks — all functions called within that block are reachable.
- Functions decorated with common web framework decorators (`@app.route`, `@router.get`, `@click.command`, etc.) — configurable via the `entryPoints` `decorator` type.

### 5.6 Entry Point Propagation

Entry points fundamentally affect the dead code analysis. The algorithm is:

1. **Mark entry points.** Based on the configuration, mark matching nodes as `isEntryPoint: true`.
2. **Compute reachability.** Starting from all entry point nodes, perform a BFS/DFS traversal following outgoing edges. Every node reachable from any entry point is marked as **"live"**.
3. **Classify nodes:**
   - **Live (green/default):** The node is reachable from at least one entry point via the call graph.
   - **Dead (red):** The node has zero incoming edges AND is not reachable from any entry point. This means: (a) no other function in the codebase calls it, AND (b) it's not declared as an entry point, AND (c) it's not reachable from any entry point.
   - **Unused parameters (yellow):** The node has one or more parameters that are never referenced in the function body. This classification is independent of the dead/live status — a live function can still have unused parameters.
   - **Dead + unused params:** A node can be both red and yellow. In this case, use **orange** as the color to indicate both issues. Or use red with a yellow border/outline (implementation detail for the viewer).

4. **The "User" virtual node.** The graph includes a special virtual node called `[entry]` (or `User` / `External Caller`). This node has outgoing edges to every entry point function. It serves as the visual root of the "live" call tree and helps the user understand what is externally invoked. This node should be visually distinct (e.g., a different shape like a diamond or star, colored blue or white).

### 5.7 Output JSON Schema

The CLI outputs a single JSON file with the following top-level structure:

```jsonc
{
  // Metadata about the analysis run.
  "metadata": {
    "version": "1.0.0",          // Schema version
    "generatedAt": "2026-02-16T12:00:00Z",  // ISO 8601 timestamp
    "language": "typescript",
    "projectRoot": "/absolute/path/to/project",
    "analysisTimeMs": 3400,       // How long analysis took
    "totalFiles": 142,
    "totalFunctions": 1873,
    "totalEdges": 4521,
    "totalDeadFunctions": 87,
    "totalUnusedParameters": 34,
    "config": { /* resolved configuration used */ }
  },

  // All function/method nodes.
  "nodes": [
    {
      "id": "src/handlers/user.ts:getUser",
      "name": "getUser",
      "qualifiedName": "src/handlers/user.ts:getUser",
      "filePath": "src/handlers/user.ts",
      "startLine": 15,
      "endLine": 42,
      "language": "typescript",
      "kind": "function",
      "visibility": "exported",
      "isEntryPoint": true,
      "parameters": [
        { "name": "req", "type": "Request", "isUsed": true, "position": 0 },
        { "name": "res", "type": "Response", "isUsed": true, "position": 1 },
        { "name": "next", "type": "NextFunction", "isUsed": false, "position": 2 }
      ],
      "unusedParameters": ["next"],
      "packageOrModule": "src/handlers",
      "linesOfCode": 27,
      "status": "live",   // "live" | "dead" | "entry"
      "color": "yellow"   // Derived: "green" | "red" | "yellow" | "orange"
    }
    // ... more nodes
  ],

  // All call edges.
  "edges": [
    {
      "source": "src/routes/api.ts:registerRoutes",
      "target": "src/handlers/user.ts:getUser",
      "callSite": {
        "filePath": "src/routes/api.ts",
        "line": 23,
        "column": 5
      },
      "kind": "direct",
      "isResolved": true
    }
    // ... more edges
  ],

  // The virtual entry node.
  "entryNode": {
    "id": "__entry__",
    "name": "External Callers",
    "targets": [
      "src/routes/api.ts:registerRoutes",
      "src/server.ts:main"
    ]
  },

  // Package/module hierarchy for clustering in the viewer.
  "clusters": [
    {
      "id": "src/handlers",
      "label": "handlers",
      "nodeIds": ["src/handlers/user.ts:getUser", "src/handlers/user.ts:createUser", "..."],
      "parent": "src"
    },
    {
      "id": "src/routes",
      "label": "routes",
      "nodeIds": ["src/routes/api.ts:registerRoutes"],
      "parent": "src"
    }
    // ...
  ],

  // Summary statistics for the viewer's dashboard.
  "stats": {
    "deadFunctions": {
      "count": 87,
      "percentage": 4.64,
      "byPackage": {
        "src/legacy": 42,
        "src/utils": 18,
        "src/handlers": 7
      }
    },
    "unusedParameters": {
      "count": 34,
      "percentage": 1.81,
      "byPackage": {
        "src/handlers": 12,
        "src/middleware": 8
      }
    },
    "entryPoints": {
      "count": 10,
      "functions": ["src/routes/api.ts:registerRoutes", "..."]
    },
    "largestFunctions": [
      { "id": "src/utils/parser.ts:parseDocument", "linesOfCode": 342 }
    ]
  }
}
```

---

## 6. Web Viewer

### 6.1 Overview

The web viewer is a local web application served by the CLI (`codegraph serve`). It loads the JSON graph file and renders it as an interactive 3D force-directed graph using Three.js. It must be performant with thousands of nodes (target: 5,000+ nodes at 60fps).

### 6.2 Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| 3D Rendering | Three.js | Industry standard, hardware-accelerated |
| Graph Layout | `3d-force-graph` or custom force simulation in Web Worker | Purpose-built for 3D graph rendering on Three.js |
| UI Overlay | Vanilla HTML/CSS or lightweight framework (Preact/Solid) | Minimal overhead; the 3D canvas is the primary UI |
| Bundler | Vite | Fast dev server, good for local tooling |
| Dev Server | Express or built-in Node HTTP | Serve the viewer + JSON data |

### 6.3 Rendering Architecture

#### 6.3.1 Performance Requirements

| Metric | Target |
|--------|--------|
| Nodes supported | 10,000+ |
| Edges supported | 50,000+ |
| Frame rate | 60fps during idle; 30fps minimum during interaction |
| Initial load (5k nodes) | < 3 seconds to first interactive frame |
| Memory usage (5k nodes) | < 500MB |

#### 6.3.2 Rendering Strategy

**Nodes:**

- Use `THREE.InstancedMesh` with a single `SphereGeometry` (or `IcosahedronGeometry` for lower poly count at distance) for ALL nodes.
- Color is set per-instance via an instance attribute buffer.
- Node size is determined by `linesOfCode` mapped to a reasonable range (e.g., radius 1–5 units). Use a logarithmic scale so very large functions don't dominate.
- The virtual `[entry]` node uses a distinct geometry (e.g., `OctahedronGeometry`) and color (blue/white).

**Edges:**

- Use `THREE.LineSegments` with a single `BufferGeometry` containing all edge positions. This draws all edges in a single draw call.
- Edge color defaults to a low-opacity gray (`rgba(150, 150, 150, 0.15)`) to avoid visual noise.
- When a node is hovered or selected, highlight its incoming and outgoing edges by dynamically updating the color buffer for those edges (bright white or colored by direction).
- Edge directionality is indicated by a subtle color gradient (lighter at source, slightly darker at target) or by small arrowhead sprites at the midpoint of each edge (only rendered when zoomed in close enough — LOD).

**Labels:**

- Do NOT render text labels for all nodes at all times. This is critical for performance.
- Render labels only for: (a) the currently hovered node, (b) the currently selected node and its immediate neighbors, (c) nodes matching a search query.
- Use `CSS2DRenderer` (from Three.js) for labels overlaid on the 3D scene. These are HTML elements positioned in 3D space, which gives crisp text at any zoom level.
- Alternatively, use sprite-based labels rendered to a canvas texture, but only for visible/relevant nodes.

#### 6.3.3 Level of Detail (LOD)

The viewer must implement LOD to maintain performance when zoomed out:

| Zoom Level | Node Rendering | Edge Rendering | Labels |
|------------|---------------|----------------|--------|
| Far (seeing whole graph) | Small points (2px), no outlines | Very thin, low opacity | None |
| Medium (seeing a cluster) | Spheres with color, slight glow for red/yellow | Thin lines, moderate opacity | Package/cluster labels only |
| Close (seeing individual nodes) | Full spheres with outlines/borders, glow effects | Full lines with directional indicators | Function names visible |
| Very close (inspecting a node) | Detailed sphere with parameter count badge | Edges colored by direction (in=green, out=blue) | Full signature, parameter list |

LOD transitions should be smooth (lerp opacity/size).

#### 6.3.4 Layout Algorithm

Use a 3D force-directed layout. This can be computed:

- **In a Web Worker** to avoid blocking the main/render thread.
- **Incrementally** — the graph is rendered immediately with initial random positions, and nodes animate into their force-directed positions over ~2–3 seconds.
- **With clustering forces** — nodes in the same `packageOrModule` cluster should attract each other and repel nodes from other clusters. This creates natural spatial grouping by package/module.

**Force parameters (tunable, with sensible defaults):**

| Force | Description | Default |
|-------|-------------|---------|
| Link distance | Distance between connected nodes | 30 |
| Link strength | How strongly edges pull nodes together | 0.1 |
| Charge (repulsion) | How strongly nodes push apart | -50 |
| Cluster attraction | Pull toward cluster centroid | 0.3 |
| Center gravity | Gentle pull toward origin to prevent drift | 0.01 |
| Collision radius | Prevent node overlap | Node radius + 2 |
| Alpha decay | How quickly the simulation settles | 0.02 |

The simulation should "cool down" and freeze after convergence. The user can manually trigger re-simulation.

### 6.4 Interaction

#### 6.4.1 Camera Controls

- **Orbit:** Click and drag to rotate the camera around the graph center.
- **Zoom:** Scroll wheel to zoom in/out. Smooth zoom with momentum.
- **Pan:** Right-click and drag (or Shift+left-click drag) to pan.
- **Fly-to:** Double-click a node to smoothly fly the camera to center on it.
- **Reset:** Button or keyboard shortcut (`R`) to reset camera to the default overview position.
- **Auto-rotate:** Optional slow rotation of the graph when idle (toggleable).

#### 6.4.2 Node Interaction

**Hover:**

- Hovering over a node highlights it (scale up slightly, increase glow/brightness).
- A tooltip appears showing: function name, file path, line number, parameter count, status (live/dead/unused params).
- Incoming and outgoing edges for the hovered node are highlighted (incoming = green, outgoing = blue).
- Immediate neighbor nodes are also subtly highlighted.
- All other nodes and edges dim slightly to increase contrast.

**Click/Select:**

- Clicking a node selects it.
- The side panel (see 6.5) opens with full details for the selected node.
- The selected node's entire upstream call chain (who calls it, recursively) and downstream call chain (what it calls, recursively) are highlighted with a brightness gradient (brighter = closer to selected node).
- Double-click to fly the camera to the node.

**Multi-select:**

- Ctrl+click (Cmd+click on macOS) to add/remove nodes from selection.
- Shift+click to select a node and all of its direct neighbors.
- Selected nodes are highlighted with a ring/outline.

#### 6.4.3 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `R` | Reset camera to overview |
| `F` | Toggle fullscreen |
| `/` or `Ctrl+K` | Open search |
| `Escape` | Deselect all / close panels |
| `1` | Show all nodes |
| `2` | Show only dead code (red nodes) |
| `3` | Show only unused params (yellow nodes) |
| `4` | Show only entry points |
| `H` | Toggle edge visibility |
| `L` | Toggle labels for all visible nodes |
| `C` | Toggle cluster coloring mode (color by package) |
| `Space` | Pause/resume force simulation |
| `Tab` | Cycle through flagged nodes (red and yellow) |

### 6.5 Side Panel

A collapsible side panel on the right side of the screen provides detailed information.

#### 6.5.1 Node Detail View (shown when a node is selected)

```
┌──────────────────────────────────────┐
│  ✕  Node Details                     │
├──────────────────────────────────────┤
│  Function: getUser                   │
│  File: src/handlers/user.ts:15       │
│  Package: src/handlers               │
│  Kind: function                      │
│  Visibility: exported                │
│  Lines of Code: 27                   │
│  Status: LIVE ● (entry point)        │
│                                      │
│  Parameters (3):                     │
│    ✅ req: Request                   │
│    ✅ res: Response                  │
│    ⚠️  next: NextFunction (UNUSED)   │
│                                      │
│  Called by (2):                       │
│    → registerRoutes (api.ts:23)      │
│    → [entry] External Callers        │
│                                      │
│  Calls (5):                          │
│    → validateToken (auth.ts:10)      │
│    → findUserById (db/users.ts:33)   │
│    → formatResponse (utils.ts:78)    │
│    → logRequest (logger.ts:5)        │
│    → handleError (errors.ts:12)      │
│                                      │
│  [View Source] [Copy ID]             │
└──────────────────────────────────────┘
```

- "Called by" entries are clickable — clicking navigates to that node (selects it, flies camera to it).
- "Calls" entries are similarly clickable.
- "View Source" opens the file in the user's default editor (via `$EDITOR` or VS Code `code --goto`) at the line number. If unavailable, copy the file path to clipboard.

#### 6.5.2 Graph Overview (shown by default when no node is selected)

```
┌──────────────────────────────────────┐
│  CodeGraph Overview                  │
├──────────────────────────────────────┤
│  Project: my-app                     │
│  Language: TypeScript                │
│  Analyzed: 142 files                 │
│  Total Functions: 1,873              │
│  Total Calls: 4,521                  │
│                                      │
│  🔴 Dead Functions: 87 (4.6%)       │
│  🟡 Unused Parameters: 34 (1.8%)    │
│  🟢 Live Functions: 1,786 (95.4%)   │
│  🔵 Entry Points: 10                │
│                                      │
│  Dead Code by Package:               │
│  ████████████░░░ src/legacy (42)     │
│  ██████░░░░░░░░░ src/utils (18)      │
│  ███░░░░░░░░░░░░ src/handlers (7)    │
│                                      │
│  [Export Report]                      │
└──────────────────────────────────────┘
```

### 6.6 Search and Filtering

#### 6.6.1 Search

- A search input field accessible via `/` or `Ctrl+K`.
- Searches across: function name, file path, qualified name, parameter names.
- As the user types, matching nodes are highlighted in the 3D view and listed in a dropdown.
- Selecting a search result flies the camera to that node and selects it.
- Search should be fuzzy (e.g., using Fuse.js or similar) with ranked results.

#### 6.6.2 Filters

The viewer provides toggleable filters accessible from a filter bar at the top or a filter panel:

| Filter | Description |
|--------|-------------|
| Status | Toggle visibility of: Live, Dead, Entry Point nodes |
| Has Unused Params | Show only nodes with unused parameters |
| Package/Module | Show/hide specific packages or modules (tree-based filter) |
| Min/Max Connections | Filter by number of incoming or outgoing edges |
| Lines of Code Range | Filter by function size |
| Visibility | Filter by exported/private/etc. |
| Kind | Filter by function/method/constructor/etc. |

When a filter hides nodes, their associated edges are also hidden. The force simulation should NOT re-run — nodes simply become transparent/invisible in place to maintain spatial stability.

#### 6.6.3 Highlight Mode

Separate from filters, the user can choose a "highlight mode" that dims non-matching nodes instead of hiding them:

- Highlight dead code only
- Highlight unused parameters only
- Highlight a specific package/module
- Highlight the reachability cone from a selected node (all nodes reachable by following edges from the selected node)
- Highlight the dependency cone for a selected node (all nodes that can reach the selected node by following edges)

### 6.7 Cluster Visualization

Packages/modules should be visually groupable. The viewer supports two clustering modes (toggleable):

#### 6.7.1 Force-Based Clustering (Default)

Nodes in the same package/module cluster are pulled together by an additional cluster force. This creates natural groupings without hard boundaries. A subtle translucent convex hull or bounding sphere can be rendered around each cluster (toggleable).

#### 6.7.2 Treemap/Nested Layout

An alternative layout where clusters are arranged as a flat plane partitioned into rectangular regions (treemap), with nodes in each region belonging to one package. The Z-axis is then used to represent call depth. This is an alternative layout mode, not the default.

### 6.8 Export

The viewer should support exporting:

| Format | Description |
|--------|-------------|
| PNG/JPEG screenshot | Current viewport capture (via `renderer.domElement.toDataURL()`) |
| JSON dead code report | List of all dead functions with file paths and line numbers |
| CSV dead code report | Same as JSON but in CSV format for spreadsheet import |
| Markdown report | Summary with tables listing dead code and unused parameters |

---

## 7. Watch Mode

When running `codegraph serve --watch`:

1. The CLI watches the source files for changes (using `chokidar` or `fs.watch`).
2. On file change, only the changed files are re-analyzed (incremental analysis).
3. The updated nodes and edges are merged into the existing graph (add new nodes, remove deleted nodes, update changed nodes, recalculate edges for changed files).
4. The updated graph JSON is pushed to the web viewer via WebSocket.
5. The viewer smoothly animates the changes: new nodes appear with a fade-in, deleted nodes fade out, moved nodes interpolate to new positions, changed colors (e.g., a function that was dead is now called) animate the color transition.
6. The force simulation briefly "re-heats" to accommodate new/removed nodes, then re-settles.

---

## 8. Nonfunctional Requirements

### 8.1 Performance

| Requirement | Target |
|-------------|--------|
| CLI analysis time (1k files, ~50k LOC) | < 10 seconds |
| CLI analysis time (5k files, ~250k LOC) | < 60 seconds |
| JSON output file size (5k nodes) | < 10 MB |
| Web viewer initial render (5k nodes) | < 3 seconds to interactive |
| Web viewer frame rate (5k nodes, idle) | 60 fps |
| Web viewer frame rate (5k nodes, interaction) | 30+ fps |
| Web viewer memory (5k nodes) | < 500 MB |
| Web viewer initial render (10k nodes) | < 5 seconds |
| Web viewer frame rate (10k nodes, idle) | 30+ fps |

### 8.2 Accuracy

| Requirement | Description |
|-------------|-------------|
| False positive rate (dead code) | < 5%. Functions incorrectly flagged as dead. Err on the side of "live" — if unsure, assume it's called. |
| False negative rate (dead code) | < 10%. Functions that are actually dead but not flagged. This is acceptable; missed dead code is less harmful than false alarms. |
| Unused parameter accuracy | > 95%. This is straightforward AST analysis and should be very accurate. |
| Call graph completeness | > 85% of statically resolvable calls should be captured. |

### 8.3 Compatibility

| Requirement | Description |
|-------------|-------------|
| TypeScript | TS 4.x and 5.x. Support JSX/TSX files. |
| Go | Go 1.18+ (with generics support). |
| Python | Python 3.8+ syntax. |
| Node.js | Node.js 18+ for the CLI. |
| Browsers | Chrome, Firefox, Edge, Safari (latest 2 versions). WebGL2 required. |
| OS | macOS, Linux, Windows (WSL). |

### 8.4 Installability

- Install via npm: `npm install -g codegraph`
- Or run without install: `npx codegraph analyze`
- Go analyzer helper: bundled as a pre-compiled binary for major platforms (macOS arm64/x64, Linux x64, Windows x64) or compiled on first run if Go toolchain is available.
- Python analyzer helper: bundled as a Python script; requires Python 3.8+ on the system (which the user should have if they're analyzing Python code).

### 8.5 Accessibility

- The viewer must have keyboard navigation support (Tab through UI elements, Enter to select).
- Color choices must account for common color vision deficiencies. In addition to red/yellow/green, use patterns, icons, or shapes as secondary indicators:
  - Dead functions: red + dashed outline
  - Unused params: yellow + striped pattern (or triangle icon)
  - Live: green or gray (no pattern)
  - Entry point: blue + star shape
- A colorblind mode toggle that switches to a perceptually distinct palette (e.g., blue/orange/purple instead of red/yellow/green).
- Tooltip text and side panel text must be readable (minimum 14px font, sufficient contrast).

---

## 9. Project Structure

```
codegraph/
├── package.json
├── tsconfig.json
├── README.md
├── bin/
│   └── codegraph.ts                 # CLI entry point
├── src/
│   ├── cli/
│   │   ├── index.ts                 # Command parsing (commander.js)
│   │   ├── config.ts                # Config file loading and merging
│   │   ├── serve.ts                 # Dev server for the viewer
│   │   └── watch.ts                 # File watcher + incremental analysis
│   ├── analyzer/
│   │   ├── types.ts                 # Shared types (Node, Edge, Graph, Parameter, etc.)
│   │   ├── base-analyzer.ts         # Abstract base class for analyzers
│   │   ├── typescript/
│   │   │   ├── ts-analyzer.ts       # TypeScript analyzer using TS compiler API
│   │   │   ├── ts-call-resolver.ts  # Resolves call expressions to target functions
│   │   │   └── ts-param-checker.ts  # Checks for unused parameters
│   │   ├── go/
│   │   │   ├── go-analyzer.ts       # Go analyzer (shells out to Go helper)
│   │   │   └── go-helper/           # Go helper binary source
│   │   │       ├── main.go
│   │   │       ├── analyzer.go
│   │   │       └── go.mod
│   │   ├── python/
│   │   │   ├── py-analyzer.ts       # Python analyzer (shells out to Python helper)
│   │   │   └── py-helper/
│   │   │       ├── analyze.py       # Python analysis script using ast module
│   │   │       └── requirements.txt
│   │   ├── graph-builder.ts         # Combines analyzer output into a unified graph
│   │   ├── entry-points.ts          # Entry point matching and reachability propagation
│   │   └── output.ts               # JSON serialization of the graph
│   └── viewer/
│       ├── index.html               # Main HTML shell
│       ├── main.ts                  # Viewer entry point
│       ├── scene/
│       │   ├── graph-scene.ts       # Three.js scene setup (camera, renderer, lights)
│       │   ├── node-renderer.ts     # InstancedMesh for nodes, LOD management
│       │   ├── edge-renderer.ts     # LineSegments for edges
│       │   ├── label-renderer.ts    # CSS2D labels
│       │   └── cluster-renderer.ts  # Cluster boundaries (convex hulls)
│       ├── layout/
│       │   ├── force-layout.ts      # Force-directed layout (Web Worker wrapper)
│       │   ├── force-worker.ts      # Web Worker: runs the force simulation
│       │   └── cluster-forces.ts    # Custom cluster attraction force
│       ├── interaction/
│       │   ├── camera-controls.ts   # Orbit, zoom, pan, fly-to
│       │   ├── raycaster.ts         # Mouse picking (hover, click on nodes)
│       │   ├── selection.ts         # Selection state management
│       │   └── keyboard.ts          # Keyboard shortcut handler
│       ├── ui/
│       │   ├── side-panel.ts        # Side panel rendering
│       │   ├── search.ts            # Search UI + fuzzy search logic
│       │   ├── filters.ts           # Filter bar UI
│       │   ├── tooltip.ts           # Hover tooltip
│       │   ├── stats-overlay.ts     # Top-left stats overlay (FPS, node count)
│       │   └── toolbar.ts           # Top toolbar (filter toggles, layout modes)
│       ├── data/
│       │   ├── graph-store.ts       # In-memory graph data + indexing
│       │   ├── graph-loader.ts      # Fetch and parse JSON, build indices
│       │   └── websocket-client.ts  # WebSocket client for watch mode updates
│       └── utils/
│           ├── colors.ts            # Color palettes (normal + colorblind mode)
│           ├── lod.ts               # LOD distance thresholds
│           └── math.ts              # Vector math helpers
├── test/
│   ├── fixtures/                    # Sample codebases for testing
│   │   ├── typescript-basic/
│   │   ├── typescript-large/
│   │   ├── go-basic/
│   │   ├── go-large/
│   │   ├── python-basic/
│   │   └── python-large/
│   ├── analyzer/
│   │   ├── ts-analyzer.test.ts
│   │   ├── go-analyzer.test.ts
│   │   └── py-analyzer.test.ts
│   ├── graph-builder.test.ts
│   ├── entry-points.test.ts
│   └── viewer/
│       └── graph-store.test.ts
└── scripts/
    └── build-go-helper.sh           # Cross-compile Go helper for all platforms
```

---

## 10. Testing Requirements

### 10.1 Analyzer Tests

For each language (TypeScript, Go, Python), create test fixture projects that cover:

| Test Case | Description |
|-----------|-------------|
| Simple call chain | A → B → C. Verify edges and node statuses. |
| Dead function | A function with no callers. Verify flagged as dead. |
| Entry point saves function | A function with no callers but declared as entry point. Verify NOT flagged as dead. |
| Entry point propagation | Entry → A → B → C. All should be live. D (unreachable) should be dead. |
| Unused parameter | `function foo(a, b) { return a; }` — `b` should be flagged. |
| All params used | `function foo(a, b) { return a + b; }` — no flags. |
| Underscore convention | `function foo(_unused, b) { return b; }` — `_unused` should NOT be flagged (configurable). |
| Recursive function | `function foo() { foo(); }` — should have a self-edge. Should still be dead if not reachable from entry. |
| Mutual recursion | A calls B, B calls A. Both should be dead if unreachable from entry points. |
| Method calls | Class method calls resolved to the correct class. |
| Interface/protocol calls (Go) | Interface method call creates edges to all implementations. |
| Re-exported functions | `export { foo } from './bar'` — call to `foo` resolves to `bar.foo`. |
| Destructured parameters | `function foo({ a, b }) { return a; }` — `b` should be flagged as unused. |
| Dynamic calls | `obj[key]()` — edge marked as unresolved. |
| Lambda/closure calls | Arrow functions and closures tracked correctly. |
| Decorator detection (Python) | Functions with `@app.route` detected as entry points. |
| Constructor calls | `new Foo()` creates edge to `Foo.constructor`. |

### 10.2 Viewer Tests

- Load a fixture JSON with 5,000 nodes and verify render completes in < 3 seconds.
- Verify node colors match expected status from JSON.
- Verify hover highlights correct edges.
- Verify search returns correct results.
- Verify filter hides/shows correct nodes.

### 10.3 Integration Tests

- End-to-end: given a fixture project, run `codegraph analyze`, verify the output JSON, then load in the viewer and verify visualization.

---

## 11. Edge Cases and Known Limitations

### 11.1 Known Limitations

| Limitation | Description |
|------------|-------------|
| Dynamic dispatch | Calls via variables, reflection, or `eval` cannot be statically resolved. These are flagged with `isResolved: false`. |
| Monkey patching (Python) | Runtime modifications to classes/modules are not tracked. |
| Metaprogramming | Code generated by macros (Go generate), decorators that dynamically create functions, or TypeScript transformers are not tracked. |
| Cross-module type narrowing | In TypeScript, complex type narrowing across module boundaries may cause missed call resolutions. |
| Python import cycles | Circular imports may cause incomplete resolution. |
| Go interface satisfaction | Only interfaces satisfied within the analyzed module are tracked. |
| External callbacks | If a function is passed to an external library as a callback (e.g., `express.get('/path', handler)`), the analyzer cannot know the library will call it. The user must declare such patterns as entry points. |

### 11.2 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Empty functions | Valid nodes with 0 edges out. May be dead code. |
| Functions with only comments | Valid nodes; treated as empty. |
| Duplicate function names | Fully qualified names (with file path) prevent ambiguity. |
| Very large files (10k+ lines) | Analyzer should process file by file; not load entire codebase into memory at once. |
| Binary/generated files | Excluded by default patterns; skip if encountered. |
| Symlinks | Resolve symlinks to canonical paths to avoid duplicate nodes. |
| Monorepos | Support multiple `include` roots. Each can have its own `tsconfig`/`go.mod`/`pyproject.toml`. |
| Git submodules | Treated as regular directories; included only if matched by `include` patterns. |

---

## 12. Future Scope (Out of Scope for v1)

These features are not part of the initial implementation but are planned for future versions:

- **Additional languages:** Rust, Java, C#, C/C++.
- **IDE integration:** VS Code extension with inline dead code highlighting and a graph panel.
- **CI/CD integration:** Run as a CI step, fail on regressions (e.g., dead code count increased).
- **Diff mode:** Compare two analysis runs and show what changed (new dead code, resolved dead code).
- **Complexity metrics:** Add cyclomatic complexity, cognitive complexity as node metadata.
- **Dependency graph mode:** Module-level graph (instead of function-level) for architectural overview.
- **Git blame integration:** Show when dead functions were last modified and by whom.
- **Auto-fix suggestions:** Generate diffs to remove dead code or strip unused parameters.
- **Remote/hosted version:** Upload JSON to a web service for sharing with teams.
- **Multi-language projects:** Analyze a project with mixed TypeScript/Python (still independent graphs, but displayed side by side or merged with explicit cross-language edges for known patterns like gRPC/REST).

---

## 13. Glossary

| Term | Definition |
|------|------------|
| Node | A function, method, constructor, or other callable unit in the source code. Represented as a sphere in the 3D graph. |
| Edge | A call relationship between two nodes. A directed edge from A to B means "A calls B." |
| Dead code | A function that has zero incoming edges and is not reachable from any entry point. It is never called. |
| Unused parameter | A function parameter that is declared but never referenced in the function body. |
| Entry point | A function that is invoked externally (by a user, HTTP request, CLI command, scheduler, etc.) and is declared as such in the configuration. |
| Live function | A function that is reachable from at least one entry point through the call graph. |
| Cluster | A group of nodes belonging to the same package, module, or directory. |
| Call graph | A directed graph where nodes are functions and edges are call relationships. |
| LOD (Level of Detail) | A rendering technique that adjusts visual complexity based on camera distance. |
| Force-directed layout | A graph layout algorithm that simulates physical forces to position nodes. |

---

## 14. Acceptance Criteria

The project is considered complete when:

1. **CLI:**
   - `codegraph analyze` successfully processes TypeScript, Go, and Python projects and produces a valid JSON output matching the schema in section 5.7.
   - Entry points are correctly identified from all configuration methods (file glob, function name, decorator, export).
   - Dead code detection correctly classifies functions as live or dead based on entry point reachability.
   - Unused parameter detection correctly identifies unused parameters with > 95% accuracy.
   - Analysis of a 5,000-function codebase completes in under 60 seconds.

2. **Web Viewer:**
   - `codegraph serve` starts a local web server and opens the 3D graph viewer.
   - The viewer renders 5,000+ nodes at 60fps during idle and 30fps during interaction.
   - Nodes are correctly colored: red (dead), yellow (unused params), orange (both), green/gray (live), blue (entry point).
   - All interactions work: orbit, zoom, pan, fly-to, hover highlight, click select, search, filter, keyboard shortcuts.
   - The side panel shows correct information for selected nodes.
   - Search finds nodes by name, file path, and parameter names.
   - Filters correctly show/hide nodes by status, package, and other criteria.
   - The virtual `[entry]` node is rendered with edges to all entry points.

3. **Watch Mode:**
   - `codegraph serve --watch` re-analyzes changed files and updates the viewer in real-time via WebSocket.
   - Changes animate smoothly (fade in/out, color transitions).

4. **Testing:**
   - All test cases in section 10.1 pass for all three languages.
   - Performance benchmarks in section 8.1 are met.

---