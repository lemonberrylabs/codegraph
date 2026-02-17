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

**Language-specific requirements:**

- **Go analysis** requires the [Go toolchain](https://go.dev/dl/) (1.18+) installed and on your `PATH`.
- **Python analysis** requires Python 3.8+.

> **Building from source?** The Go helper binary shipped in the repo is built for Linux ARM64. If you're on macOS or another platform, the CLI will auto-build it on first run using your local Go toolchain. You can also build it manually:
>
> ```bash
> cd src/analyzer/go/go-helper && go build -o go-helper .
> ```

## Quick Start

```bash
# Analyze a project (auto-detects language)
codegraph analyze

# Analyze and open the 3D viewer
codegraph serve --open

# Analyze with live-reload on file changes
codegraph serve --open --watch
```

CodeGraph auto-detects the language from project files (`tsconfig.json`/`package.json` for TypeScript, `go.mod` for Go, `pyproject.toml`/`setup.py`/`requirements.txt` for Python).

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

**Example:**

```bash
codegraph analyze --language typescript --include "src/**/*.ts" --entry "src/routes/**/*.ts" --output graph.json
```

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
codegraph serve --open --watch --port 3000
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

Go `main()` and `init()` functions are automatically treated as entry points.

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

```bash
pnpm install
pnpm run build:cli      # Build CLI
pnpm run dev:viewer     # Dev server for viewer
pnpm run build:viewer   # Production build for viewer
pnpm run test           # Run tests
pnpm run typecheck      # Type checking
```

## License

MIT
