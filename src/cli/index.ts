import { Command } from 'commander';
import { resolve } from 'node:path';
import { resolveConfig } from './config.js';
import { runAnalysis } from '../analyzer/graph-builder.js';
import { writeOutput } from '../analyzer/output.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('codegraph')
    .description('Codebase call-graph visualizer with dead code detection')
    .version('1.0.0');

  program
    .command('analyze')
    .description('Run static analysis and output a call graph JSON file')
    .option('-l, --language <lang>', 'Language to analyze (typescript, go, python)')
    .option('-i, --include <patterns...>', 'File patterns to include')
    .option('-x, --exclude <patterns...>', 'File patterns to exclude')
    .option('-e, --entry <patterns...>', 'Entry point file patterns')
    .option('-o, --output <path>', 'Output JSON file path')
    .option('-c, --config <path>', 'Path to config file')
    .option('--tsconfig <path>', 'Path to tsconfig.json (TypeScript only)')
    .option('-r, --root <path>', 'Project root directory', '.')
    .action(async (options) => {
      try {
        const projectRoot = resolve(options.root);
        const config = resolveConfig(projectRoot, {
          language: options.language,
          include: options.include,
          exclude: options.exclude,
          entry: options.entry,
          output: options.output,
          config: options.config,
          tsconfig: options.tsconfig,
        });

        console.log(`Analyzing ${config.language} project at ${config.projectRoot}...`);
        console.log(`Include: ${config.include.join(', ')}`);
        console.log(`Exclude: ${config.exclude.length} patterns`);
        console.log(`Entry points: ${config.entryPoints.length} rules`);

        const graph = await runAnalysis(config);

        const outputPath = resolve(config.projectRoot, config.output);
        writeOutput(graph, outputPath);

        console.log(`\nAnalysis complete!`);
        console.log(`  Functions: ${graph.metadata.totalFunctions}`);
        console.log(`  Calls: ${graph.metadata.totalEdges}`);
        console.log(`  Dead functions: ${graph.metadata.totalDeadFunctions}`);
        console.log(`  Unused parameters: ${graph.metadata.totalUnusedParameters}`);
        console.log(`  Time: ${graph.metadata.analysisTimeMs}ms`);
        console.log(`\nOutput written to: ${outputPath}`);
      } catch (err) {
        console.error('Analysis failed:', (err as Error).message);
        process.exit(1);
      }
    });

  program
    .command('serve')
    .description('Run analysis and start the web viewer')
    .option('-l, --language <lang>', 'Language to analyze')
    .option('-i, --include <patterns...>', 'File patterns to include')
    .option('-x, --exclude <patterns...>', 'File patterns to exclude')
    .option('-e, --entry <patterns...>', 'Entry point file patterns')
    .option('-o, --output <path>', 'Output JSON file path')
    .option('-p, --port <port>', 'Server port', '8080')
    .option('--no-open', 'Do not auto-open browser')
    .option('--watch', 'Re-analyze on file changes')
    .option('-c, --config <path>', 'Path to config file')
    .option('--tsconfig <path>', 'Path to tsconfig.json (TypeScript only)')
    .option('-r, --root <path>', 'Project root directory', '.')
    .action(async (options) => {
      try {
        const projectRoot = resolve(options.root);
        const config = resolveConfig(projectRoot, {
          language: options.language,
          include: options.include,
          exclude: options.exclude,
          entry: options.entry,
          output: options.output,
          config: options.config,
          tsconfig: options.tsconfig,
        });

        const { startServer } = await import('./serve.js');
        await startServer(config, {
          port: parseInt(options.port, 10),
          open: options.open || false,
          watch: options.watch || false,
        });
      } catch (err) {
        console.error('Server failed:', (err as Error).message);
        process.exit(1);
      }
    });

  return program;
}
