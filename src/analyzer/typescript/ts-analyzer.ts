import ts from 'typescript';
import { resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { BaseAnalyzer } from '../base-analyzer.js';
import { extractParameters } from './ts-param-checker.js';
import { resolveCallsInFunction } from './ts-call-resolver.js';
import type {
  AnalyzerResult,
  GraphNode,
  GraphEdge,
  FunctionKind,
  Visibility,
} from '../types.js';

export class TypeScriptAnalyzer extends BaseAnalyzer {
  private program!: ts.Program;
  private checker!: ts.TypeChecker;
  private nodeIdMap = new Map<ts.Node, string>();
  private symbolToNodeId = new Map<ts.Symbol, string>();

  async analyze(): Promise<AnalyzerResult> {
    const files = await this.resolveFiles();
    const absoluteFiles = files.map(f => resolve(this.config.projectRoot, f));

    // Create TypeScript program
    const tsconfigPath = this.resolveTsConfig();
    this.program = this.createProgram(absoluteFiles, tsconfigPath);
    this.checker = this.program.getTypeChecker();

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // First pass: collect all function declarations as nodes
    const sourceFiles = this.program.getSourceFiles().filter(sf =>
      !sf.isDeclarationFile && absoluteFiles.includes(sf.fileName)
    );

    for (const sourceFile of sourceFiles) {
      const fileNodes = this.extractNodes(sourceFile);
      nodes.push(...fileNodes);
    }

    // Second pass: resolve call expressions to edges
    for (const sourceFile of sourceFiles) {
      const fileEdges = this.extractEdges(sourceFile);
      edges.push(...fileEdges);
    }

    return {
      nodes,
      edges,
      files: sourceFiles.length,
    };
  }

  private resolveTsConfig(): string | undefined {
    if (this.config.typescript?.tsconfig) {
      return resolve(this.config.projectRoot, this.config.typescript.tsconfig);
    }
    const defaultPath = resolve(this.config.projectRoot, 'tsconfig.json');
    return existsSync(defaultPath) ? defaultPath : undefined;
  }

  private createProgram(files: string[], tsconfigPath?: string): ts.Program {
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      allowJs: true,
      jsx: ts.JsxEmit.React,
      noEmit: true,
      skipLibCheck: true,
    };

    if (tsconfigPath && existsSync(tsconfigPath)) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (configFile.config) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          this.config.projectRoot
        );
        compilerOptions = { ...parsed.options, noEmit: true, skipLibCheck: true };
        // If tsconfig includes files, merge with our files
        if (parsed.fileNames.length > 0 && files.length === 0) {
          files = parsed.fileNames;
        }
      }
    }

    return ts.createProgram(files, compilerOptions);
  }

  /** Extract all function/method declarations from a source file */
  private extractNodes(sourceFile: ts.SourceFile): GraphNode[] {
    const nodes: GraphNode[] = [];
    const relPath = relative(this.config.projectRoot, sourceFile.fileName);

    const visit = (node: ts.Node, parentClass?: string) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        const graphNode = this.createNode(node, node.name.text, relPath, sourceFile, 'function', parentClass);
        if (graphNode) nodes.push(graphNode);
      }

      if (ts.isMethodDeclaration(node) && node.name) {
        const name = node.name.getText(sourceFile);
        const graphNode = this.createNode(node, name, relPath, sourceFile, 'method', parentClass);
        if (graphNode) nodes.push(graphNode);
      }

      if (ts.isConstructorDeclaration(node)) {
        const graphNode = this.createNode(node, 'constructor', relPath, sourceFile, 'constructor', parentClass);
        if (graphNode) nodes.push(graphNode);
      }

      if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        const name = node.name.getText(sourceFile);
        const prefix = ts.isGetAccessorDeclaration(node) ? 'get ' : 'set ';
        const graphNode = this.createNode(node, prefix + name, relPath, sourceFile, 'method', parentClass);
        if (graphNode) nodes.push(graphNode);
      }

      // Arrow functions assigned to const/let/var
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            const name = ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(sourceFile);
            const graphNode = this.createNode(
              decl.initializer,
              name,
              relPath,
              sourceFile,
              'arrow',
              parentClass
            );
            if (graphNode) nodes.push(graphNode);
          }
        }
      }

      // Class property arrows
      if (ts.isPropertyDeclaration(node) && node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        const name = node.name.getText(sourceFile);
        const graphNode = this.createNode(node.initializer, name, relPath, sourceFile, 'arrow', parentClass);
        if (graphNode) nodes.push(graphNode);
      }

      // Recurse into classes
      if (ts.isClassDeclaration(node)) {
        const className = node.name?.text || '<anonymous>';
        ts.forEachChild(node, child => visit(child, className));
        return;
      }

      // Recurse but skip function bodies (we already process them)
      if (!ts.isFunctionDeclaration(node) && !ts.isMethodDeclaration(node) &&
          !ts.isConstructorDeclaration(node) && !ts.isArrowFunction(node) &&
          !ts.isFunctionExpression(node) && !ts.isGetAccessorDeclaration(node) &&
          !ts.isSetAccessorDeclaration(node)) {
        ts.forEachChild(node, child => visit(child, parentClass));
      }
    };

    ts.forEachChild(sourceFile, child => visit(child));
    return nodes;
  }

  /** Create a GraphNode from a TS AST node */
  private createNode(
    node: ts.FunctionLikeDeclaration,
    name: string,
    filePath: string,
    sourceFile: ts.SourceFile,
    kind: FunctionKind,
    parentClass?: string
  ): GraphNode | null {
    const qualifiedName = parentClass ? `${parentClass}.${name}` : name;
    const id = `${filePath}:${qualifiedName}`;

    const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

    const visibility = this.getVisibility(node, sourceFile);
    const { parameters, unusedParameters } = extractParameters(node, this.checker, sourceFile);

    // Register the node for call resolution
    this.nodeIdMap.set(node, id);
    const symbol = this.getNodeSymbol(node);
    if (symbol) {
      this.symbolToNodeId.set(symbol, id);
    }

    const decorators = this.extractDecorators(node, sourceFile);

    return {
      id,
      name,
      qualifiedName: `${filePath}:${qualifiedName}`,
      filePath,
      startLine,
      endLine,
      language: 'typescript',
      kind,
      visibility,
      isEntryPoint: false,
      parameters,
      unusedParameters,
      packageOrModule: this.getPackageOrModule(filePath),
      linesOfCode: endLine - startLine + 1,
      status: 'dead', // Will be updated by entry point propagation
      color: 'red',   // Will be updated
      ...(decorators.length > 0 ? { decorators } : {}),
    };
  }

  private getNodeSymbol(node: ts.FunctionLikeDeclaration): ts.Symbol | undefined {
    // For function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      return this.checker.getSymbolAtLocation(node.name);
    }
    // For methods
    if (ts.isMethodDeclaration(node) && node.name) {
      return this.checker.getSymbolAtLocation(node.name);
    }
    // For constructors
    if (ts.isConstructorDeclaration(node)) {
      const parent = node.parent;
      if (ts.isClassDeclaration(parent) && parent.name) {
        return this.checker.getSymbolAtLocation(parent.name);
      }
    }
    // For arrow functions in variable declarations
    const parent = node.parent;
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return this.checker.getSymbolAtLocation(parent.name);
    }
    // For property declarations
    if (parent && ts.isPropertyDeclaration(parent)) {
      return this.checker.getSymbolAtLocation(parent.name);
    }
    return undefined;
  }

  /** Extract decorator names from a function/method declaration */
  private extractDecorators(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string[] {
    const decorators: string[] = [];

    // Check the function/method itself for decorators
    const decoratorNodes = this.getDecoratorNodes(node);
    for (const dec of decoratorNodes) {
      const name = this.getDecoratorName(dec, sourceFile);
      if (name) decorators.push(name);
    }

    // Also check parent variable statement for decorators (e.g., decorated arrow functions)
    const parent = node.parent;
    if (parent && ts.isVariableDeclaration(parent)) {
      const varStatement = parent.parent?.parent;
      if (varStatement && ts.isVariableStatement(varStatement)) {
        const parentDecs = this.getDecoratorNodes(varStatement);
        for (const dec of parentDecs) {
          const name = this.getDecoratorName(dec, sourceFile);
          if (name) decorators.push(name);
        }
      }
    }

    return decorators;
  }

  /** Get decorator nodes from a declaration */
  private getDecoratorNodes(node: ts.Node): ts.Decorator[] {
    if (!ts.canHaveDecorators(node)) return [];
    const decorators = ts.getDecorators(node);
    return decorators ? [...decorators] : [];
  }

  /** Get the name string of a decorator (e.g., "Route", "app.route") */
  private getDecoratorName(decorator: ts.Decorator, sourceFile: ts.SourceFile): string | null {
    const expr = decorator.expression;

    // @Decorator
    if (ts.isIdentifier(expr)) {
      return expr.text;
    }

    // @Decorator()
    if (ts.isCallExpression(expr)) {
      const callee = expr.expression;
      if (ts.isIdentifier(callee)) {
        return callee.text;
      }
      // @obj.decorator()
      if (ts.isPropertyAccessExpression(callee)) {
        return callee.getText(sourceFile);
      }
    }

    // @obj.decorator
    if (ts.isPropertyAccessExpression(expr)) {
      return expr.getText(sourceFile);
    }

    return null;
  }

  private getVisibility(node: ts.Node, sourceFile: ts.SourceFile): Visibility {
    // Check for export keyword
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;

    if (modifiers) {
      for (const mod of modifiers) {
        if (mod.kind === ts.SyntaxKind.ExportKeyword) return 'exported';
        if (mod.kind === ts.SyntaxKind.PrivateKeyword) return 'private';
        if (mod.kind === ts.SyntaxKind.ProtectedKeyword) return 'internal';
        if (mod.kind === ts.SyntaxKind.PublicKeyword) return 'public';
      }
    }

    // Check parent for export
    const parent = node.parent;
    if (parent && ts.isVariableStatement(parent)) {
      const parentMods = ts.getModifiers(parent);
      if (parentMods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        return 'exported';
      }
    }

    // Check if it's a class method (default public)
    if (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
      return 'public';
    }

    return 'module';
  }

  /** Extract all call edges from a source file */
  private extractEdges(sourceFile: ts.SourceFile): GraphEdge[] {
    const edges: GraphEdge[] = [];

    const isFuncLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
      ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) || ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) || ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node);

    const visit = (node: ts.Node) => {
      if (isFuncLike(node)) {
        const id = this.nodeIdMap.get(node);
        if (id) {
          const callEdges = resolveCallsInFunction(
            node,
            id,
            this.checker,
            sourceFile,
            this.nodeIdMap,
            this.symbolToNodeId
          );
          edges.push(...callEdges);
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return edges;
  }
}
