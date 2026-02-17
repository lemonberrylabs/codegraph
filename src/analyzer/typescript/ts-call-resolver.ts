import ts from 'typescript';
import { relative } from 'node:path';
import type { GraphEdge, EdgeKind } from '../types.js';

/**
 * Resolve all call expressions within a function body to their target functions.
 */
export function resolveCallsInFunction(
  funcNode: ts.FunctionLikeDeclaration,
  sourceNodeId: string,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  nodeIdMap: Map<ts.Node, string>,
  symbolToNodeId: Map<ts.Symbol, string>
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  if (!funcNode.body) return edges;

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const edge = resolveCallExpression(node, sourceNodeId, checker, sourceFile, symbolToNodeId);
      if (edge) {
        edges.push(edge);
      }
    }

    // Detect function references passed as arguments (callbacks)
    // e.g. items.map(transformItem), arr.filter(isValid)
    if (ts.isCallExpression(node)) {
      for (const arg of node.arguments) {
        if (ts.isIdentifier(arg)) {
          const edge = resolveCallbackReference(arg, sourceNodeId, checker, sourceFile, symbolToNodeId);
          if (edge) {
            edges.push(edge);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(funcNode.body, visit);
  return edges;
}

function resolveCallExpression(
  node: ts.CallExpression | ts.NewExpression,
  sourceNodeId: string,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  symbolToNodeId: Map<ts.Symbol, string>
): GraphEdge | null {
  const expression = node.expression;
  const isNew = ts.isNewExpression(node);

  // Handle dynamic/element access calls: obj[key]()
  if (ts.isCallExpression(node) && ts.isElementAccessExpression(expression)) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return {
      source: sourceNodeId,
      target: `[dynamic:${expression.getText(sourceFile)}]`,
      callSite: {
        filePath: relative(process.cwd(), sourceFile.fileName),
        line: line + 1,
        column: character + 1,
      },
      kind: 'dynamic',
      isResolved: false,
    };
  }

  try {
    let symbol = getCallTargetSymbol(expression, checker);
    if (!symbol) return null;

    // Follow aliases (imports)
    if (symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }

    const targetId = symbolToNodeId.get(symbol);
    if (!targetId) return null; // External function, skip

    const kind: EdgeKind = isNew
      ? 'constructor'
      : ts.isPropertyAccessExpression(expression)
        ? 'method'
        : 'direct';

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

    return {
      source: sourceNodeId,
      target: targetId,
      callSite: {
        filePath: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
      },
      kind,
      isResolved: true,
    };
  } catch {
    // Could not resolve — create an unresolved edge if we at least know the name
    return null;
  }
}

function resolveCallbackReference(
  node: ts.Identifier,
  sourceNodeId: string,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  symbolToNodeId: Map<ts.Symbol, string>
): GraphEdge | null {
  try {
    let symbol = checker.getSymbolAtLocation(node);
    if (!symbol) return null;

    if (symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }

    const targetId = symbolToNodeId.get(symbol);
    if (!targetId) return null;

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

    return {
      source: sourceNodeId,
      target: targetId,
      callSite: {
        filePath: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
      },
      kind: 'callback',
      isResolved: true,
    };
  } catch {
    return null;
  }
}

function getCallTargetSymbol(
  expression: ts.Expression,
  checker: ts.TypeChecker
): ts.Symbol | undefined {
  if (ts.isIdentifier(expression)) {
    return checker.getSymbolAtLocation(expression);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return checker.getSymbolAtLocation(expression.name);
  }

  if (ts.isElementAccessExpression(expression)) {
    // Dynamic access — cannot resolve statically
    return undefined;
  }

  return undefined;
}
