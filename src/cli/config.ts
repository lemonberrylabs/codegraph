import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { CodeGraphConfig, ResolvedConfig, Language } from '../analyzer/types.js';

const CONFIG_FILENAMES = ['codegraph.config.json', 'codegraph.config.yaml'];

const DEFAULT_EXCLUDE = [
  'node_modules/**',
  'dist/**',
  'build/**',
  'vendor/**',
  '__pycache__/**',
  '.git/**',
];

const LANGUAGE_DEFAULTS: Record<Language, { include: string[]; exclude: string[] }> = {
  typescript: {
    include: ['**/*.ts', '**/*.tsx'],
    exclude: [...DEFAULT_EXCLUDE, '**/*.test.ts', '**/*.spec.ts', '**/*.d.ts'],
  },
  go: {
    include: ['**/*.go'],
    exclude: [...DEFAULT_EXCLUDE, '**/*_test.go'],
  },
  python: {
    include: ['**/*.py'],
    exclude: [...DEFAULT_EXCLUDE, '**/*_test.py', '**/test_*.py'],
  },
};

/** Find and load the config file from the project root */
export function findConfigFile(projectRoot: string): string | null {
  for (const name of CONFIG_FILENAMES) {
    const path = resolve(projectRoot, name);
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

/** Load config from a file */
export function loadConfigFile(configPath: string): Partial<CodeGraphConfig> {
  const content = readFileSync(configPath, 'utf-8');

  if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
    const esmRequire = createRequire(import.meta.url);
    const yaml = esmRequire('js-yaml') as typeof import('js-yaml');
    return yaml.load(content) as Partial<CodeGraphConfig>;
  }

  return JSON.parse(content) as Partial<CodeGraphConfig>;
}

/** CLI options that can override config */
export interface CliOptions {
  language?: string;
  include?: string[];
  exclude?: string[];
  entry?: string[];
  output?: string;
  config?: string;
  tsconfig?: string;
}

/** Merge CLI options with config file and defaults to produce a resolved config */
export function resolveConfig(projectRoot: string, cliOptions: CliOptions = {}): ResolvedConfig {
  const absRoot = resolve(projectRoot);

  // Load config file
  let fileConfig: Partial<CodeGraphConfig> = {};
  const configPath = cliOptions.config
    ? resolve(absRoot, cliOptions.config)
    : findConfigFile(absRoot);

  if (configPath && existsSync(configPath)) {
    fileConfig = loadConfigFile(configPath);
  }

  // Determine language (CLI > file > auto-detect)
  const language = (cliOptions.language || fileConfig.language || detectLanguage(absRoot)) as Language;
  if (!language) {
    throw new Error(
      'Could not determine language. Specify --language or set "language" in config file.'
    );
  }

  const langDefaults = LANGUAGE_DEFAULTS[language];

  // Merge include patterns (CLI > file > defaults)
  const include = cliOptions.include?.length
    ? cliOptions.include
    : fileConfig.include?.length
      ? fileConfig.include
      : langDefaults.include;

  // Merge exclude patterns (CLI appends to defaults + file)
  const exclude = [
    ...langDefaults.exclude,
    ...(fileConfig.exclude || []),
    ...(cliOptions.exclude || []),
  ];

  // Merge entry points
  const entryPoints = [...(fileConfig.entryPoints || [])];
  if (cliOptions.entry) {
    for (const e of cliOptions.entry) {
      // CLI entries are treated as file glob patterns
      entryPoints.push({ type: 'file', pattern: e });
    }
  }

  // Output path
  const output = cliOptions.output || fileConfig.output || './codegraph-output.json';

  // Language-specific options
  const typescript = {
    ...fileConfig.typescript,
    ...(cliOptions.tsconfig ? { tsconfig: cliOptions.tsconfig } : {}),
  };

  return {
    language,
    include,
    exclude: [...new Set(exclude)],
    entryPoints,
    output,
    typescript,
    go: fileConfig.go || {},
    python: fileConfig.python || {},
    projectRoot: absRoot,
  };
}

/** Auto-detect language from project files */
function detectLanguage(projectRoot: string): Language | null {
  if (existsSync(resolve(projectRoot, 'tsconfig.json'))) return 'typescript';
  if (existsSync(resolve(projectRoot, 'package.json'))) return 'typescript';
  if (existsSync(resolve(projectRoot, 'go.mod'))) return 'go';
  if (existsSync(resolve(projectRoot, 'pyproject.toml'))) return 'python';
  if (existsSync(resolve(projectRoot, 'setup.py'))) return 'python';
  if (existsSync(resolve(projectRoot, 'requirements.txt'))) return 'python';
  return null;
}
