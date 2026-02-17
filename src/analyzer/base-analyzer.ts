import type { AnalyzerResult, ResolvedConfig } from './types.js';

/**
 * Abstract base class for language-specific analyzers.
 * Each analyzer parses source files, extracts functions/methods,
 * resolves call sites, and detects unused parameters.
 */
export abstract class BaseAnalyzer {
  protected config: ResolvedConfig;

  constructor(config: ResolvedConfig) {
    this.config = config;
  }

  /** Run the full analysis and return nodes + edges */
  abstract analyze(): Promise<AnalyzerResult>;

  /** Get resolved file paths matching include/exclude patterns */
  protected async resolveFiles(): Promise<string[]> {
    const { glob } = await import('glob');
    const included: string[] = [];

    for (const pattern of this.config.include) {
      const matches = await glob(pattern, {
        cwd: this.config.projectRoot,
        absolute: false,
        ignore: this.config.exclude,
        nodir: true,
      });
      included.push(...matches);
    }

    // Deduplicate
    return [...new Set(included)];
  }

  /** Derive the package/module from a file path */
  protected getPackageOrModule(filePath: string): string {
    const parts = filePath.split('/');
    // Use the directory as the package/module
    if (parts.length > 1) {
      return parts.slice(0, -1).join('/');
    }
    return '.';
  }
}
