# CodeGraph

A local-first developer tool that performs static analysis on codebases (TypeScript, Go, Python), builds function-level call graphs, and renders them as interactive 3D visualizations. It detects dead code and unused parameters.

## Installation

Requires **Node.js 18+**.

```bash
npm install -g codegraph
```

Or run without installing:

```bash
npx codegraph analyze
```

### Language Requirements

| Language | Requirement | Notes |
|---|---|---|
| TypeScript | None (built-in) | Uses the TypeScript Compiler API |
| Go | [Go toolchain](https://go.dev/dl/) 1.21+ | Type-aware analysis with interface dispatch resolution |
| Python | Python 3.8+ | AST-based analysis via helper script |

> **Building from source?** The Go helper binary is not shipped in the repo. The CLI auto-builds it on first run using your local Go toolchain. You can also build it manually:
>
> ```bash
> cd src/analyzer/go/go-helper && go build -o go-helper .
> ```

## Quick Start

```bash
# Analyze a project (auto-detects language)
codegraph analyze

# Analyze and open the 3D viewer
codegraph serve

# Analyze with live-reload on file changes
codegraph serve --watch
```

CodeGraph auto-detects the language from project files (`tsconfig.json`/`package.json` for TypeScript, `go.mod` for Go, `pyproject.toml`/`setup.py`/`requirements.txt` for Python).

## Usage Examples

### TypeScript

```bash
# Analyze a Next.js project, marking route handlers as entry points
codegraph serve -r ./my-app --include "src/**/*.ts" --entry "src/routes/**/*.ts"

# Analyze with a custom tsconfig
codegraph analyze --tsconfig ./tsconfig.build.json
```

### Go

Go analysis uses `golang.org/x/tools/go/packages` for type-aware call graph construction. It resolves interface method calls to all concrete implementations — so when `handler.ServeHTTP()` is called through an `http.Handler` interface, edges are created to every type that implements `ServeHTTP`.

```bash
# Analyze a Go project with an entry point
codegraph serve -r /path/to/go/project -e internal/http/server.go

# Analyze with live reload — re-analyzes as you edit Go files
codegraph serve -r /path/to/go/project -e cmd/api/main.go --watch
```

**Requirements:**
- Go 1.21+ on your `PATH`
- A valid `go.mod` in the project root (required for type-aware analysis)
- Dependencies fetched (`go mod download` — the analyzer loads packages via the Go build system)

If `go.mod` is missing or the project has compilation errors, the analyzer falls back to AST-only analysis (no interface dispatch, no cross-package type resolution).

**What gets detected automatically:**
- `main()` and `init()` functions are always entry points
- `TestXxx`, `BenchmarkXxx`, and `ExampleXxx` functions are entry points
- Exported vs unexported visibility
- Unused function parameters

### Python

```bash
codegraph serve -r ./my-python-app --include "src/**/*.py" --entry "src/main.py"
```

## Commands

### `codegraph analyze`

Run static analysis and output a call graph JSON file.

```bash
codegraph analyze [options]
```

| Option | Description |
|---|---|
| `-l, --language <lang>` | Language to analyze (`typescript`, `go`, `python`) |
| `-i, --include <patterns...>` | File glob patterns to include |
| `-x, --exclude <patterns...>` | File glob patterns to exclude |
| `-e, --entry <patterns...>` | Entry point file patterns |
| `-o, --output <path>` | Output JSON file path (default: `./codegraph-output.json`) |
| `-c, --config <path>` | Path to config file |
| `--tsconfig <path>` | Path to `tsconfig.json` (TypeScript only) |
| `-r, --root <path>` | Project root directory (default: `.`) |

### `codegraph serve`

Run analysis and start the interactive 3D web viewer.

```bash
codegraph serve [options]
```

Supports all `analyze` options, plus:

| Option | Description |
|---|---|
| `-p, --port <port>` | Server port (default: `8080`) |
| `--no-open` | Do not auto-open browser (opens by default) |
| `--watch` | Re-analyze on file changes and live-update the viewer |

**Example:**

```bash
codegraph serve --watch --port 3000
```

## Configuration File

Place a `codegraph.config.json` (or `codegraph.config.yaml`) at the root of your project. CLI flags override config file values.

```jsonc
{
  "language": "typescript",

  "include": ["src/**/*.ts", "lib/**/*.ts"],

  "exclude": ["**/*.test.ts", "**/*.spec.ts"],

  // Entry points — functions invoked externally that should NOT be flagged as dead code.
  "entryPoints": [
    { "type": "file", "pattern": "src/routes/**/*.ts" },
    { "type": "function", "name": "main" },
    { "type": "decorator", "name": "app.route" },
    { "type": "export", "pattern": "src/index.ts" }
  ],

  "output": "./codegraph-output.json",

  // Language-specific options
  "typescript": {
    "tsconfig": "./tsconfig.json"
  },
  "go": {
    "module": "",
    "buildTags": []
  },
  "python": {
    "pythonVersion": "3.10",
    "venvPath": "",
    "sourceRoots": []
  }
}
```

### Entry Point Types

Entry points prevent externally-invoked functions from being falsely flagged as dead code. Any function reachable from an entry point through the call graph is considered "live."

| Type | Description | Example |
|---|---|---|
| `file` | All exported functions in matched files | `{ "type": "file", "pattern": "src/routes/**/*.ts" }` |
| `function` | Specific function by name | `{ "type": "function", "name": "main" }` |
| `decorator` | Functions with a matching decorator | `{ "type": "decorator", "name": "app.route" }` |
| `export` | All exported symbols from matched files | `{ "type": "export", "pattern": "src/index.ts" }` |

Go `main()`, `init()`, `TestXxx`, `BenchmarkXxx`, and `ExampleXxx` functions are automatically treated as entry points.

## 3D Viewer

The viewer renders your call graph as an interactive 3D force-directed graph.

### Node Colors

| Color | Meaning |
|---|---|
| Green/Gray | Live function — reachable from an entry point |
| Red | Dead code — no callers, unreachable from any entry point |
| Yellow | Has unused parameters |
| Orange | Dead code AND has unused parameters |
| Blue | Entry point (externally invoked) |

### Mouse Controls

- **Orbit** — Click and drag to rotate
- **Zoom** — Scroll wheel
- **Pan** — Right-click drag or Shift+left-click drag
- **Fly-to** — Double-click a node to center on it
- **Select** — Click a node to view details in the side panel
- **Multi-select** — Ctrl/Cmd+click to add/remove from selection

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `/` or `Ctrl+K` | Open search |
| `Escape` | Deselect all / close panels |
| `R` | Reset camera to overview |
| `F` | Toggle fullscreen |
| `1` | Show all nodes |
| `2` | Show only dead code |
| `3` | Show only unused params |
| `4` | Show only entry points |
| `H` | Toggle edge visibility |
| `L` | Toggle labels |
| `C` | Toggle cluster coloring (color by package) |
| `A` | Toggle auto-rotate |
| `Space` | Pause/resume force simulation |
| `Tab` | Cycle through flagged nodes |
| `?` | Show help overlay |

### Search and Filtering

Press `/` to open fuzzy search across function names, file paths, and parameter names. The viewer also provides filter toggles for status, package, connection count, lines of code, visibility, and function kind.

### Exports

The viewer can export:

- **PNG screenshot** of the current viewport
- **JSON dead code report** — list of all dead functions
- **CSV dead code report** — for spreadsheet import
- **Markdown report** — summary with tables

### Watch Mode

With `--watch`, the viewer live-updates when source files change. Changed files are re-analyzed, and the graph animates the updates — new nodes fade in, removed nodes fade out, color changes transition smoothly.

## Output Format

The `analyze` command produces a JSON file containing:

- **`metadata`** — analysis timestamp, language, file/function/edge counts, timing
- **`nodes`** — all functions with name, file path, lines, parameters, status, and color
- **`edges`** — all call relationships with source, target, call site location, and kind
- **`entryNode`** — virtual node representing external callers
- **`clusters`** — package/module groupings
- **`stats`** — dead code and unused parameter summaries by package

## Development

### Setup

```bash
git clone <repo-url>
cd codegraph
pnpm install
```

### Build

```bash
pnpm run build:cli      # Build CLI (TypeScript → dist/)
pnpm run build:viewer   # Production build for viewer (Vite → dist/viewer/)
pnpm run build          # Both
```

### Running Locally

There are three ways to run CodeGraph from source, depending on what you're working on:

#### 1. Quick run (analyze a project)

Build the CLI once, then point it at any project:

```bash
pnpm run build:cli
node ./dist/bin/codegraph.js serve -r /path/to/project
```

#### 2. Live reload for the target project (`--watch`)

Re-analyzes and pushes graph updates to the browser whenever **target project files** change. Use this when you're exploring a codebase and editing its source:

```bash
pnpm run build:cli
node ./dist/bin/codegraph.js serve -r /path/to/project -e main.go --watch
```

The browser graph updates automatically via WebSocket — no page refresh needed.

#### 3. Full dev mode (viewer + analyzer development)

If you're developing CodeGraph itself (changing viewer code, analyzer logic, etc.), run two processes:

```bash
# Terminal 1 — Vite dev server with hot module reload (port 3000)
pnpm run dev:viewer

# Terminal 2 — Backend API server (port 8080)
pnpm run build:cli
node ./dist/bin/codegraph.js serve -r /path/to/project --no-open --watch
```

Open `http://localhost:3000` — the Vite dev server proxies `/api` and `/ws` to the backend on port 8080. Viewer changes hot-reload instantly; analyzer changes require re-running `pnpm run build:cli` and restarting terminal 2.

### Rebuilding the Go Helper

The Go helper binary is built automatically on first use. To rebuild manually after making changes to `src/analyzer/go/go-helper/main.go`:

```bash
cd src/analyzer/go/go-helper
go build -o go-helper .
```

Cross-compile for all platforms:

```bash
./scripts/build-go-helper.sh
```

### Testing

```bash
pnpm run test           # Run all tests
pnpm run typecheck      # Type checking only
```

### Project Structure

```
src/
├── cli/                 # CLI commands (analyze, serve)
├── analyzer/
│   ├── base-analyzer.ts # Shared analyzer logic
│   ├── types.ts         # Shared types
│   ├── ts/              # TypeScript analyzer (Compiler API)
│   ├── go/              # Go analyzer
│   │   ├── go-analyzer.ts   # TypeScript orchestrator
│   │   └── go-helper/       # Go binary (type-aware analysis)
│   │       └── main.go      # packages.Load + go/types + interface dispatch
│   └── python/          # Python analyzer
│       ├── py-analyzer.ts
│       └── py-helper/
├── viewer/              # Three.js 3D viewer (Vite app)
│   ├── main.ts
│   ├── scene/           # 3D rendering
│   ├── interaction/     # Mouse, keyboard, selection
│   ├── layout/          # Force-directed layout (Web Worker)
│   └── ui/              # Panels, search, filters
test/
├── fixtures/            # Test projects (go-basic, go-interfaces, ts-*, py-*)
└── analyzer/            # Analyzer test suites
```

## License

MIT
