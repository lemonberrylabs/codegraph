import ts from 'typescript';
import type { Parameter } from '../types.js';

/**
 * Extract parameters from a function declaration and check if each is used.
 */
export function extractParameters(
  node: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): { parameters: Parameter[]; unusedParameters: string[] } {
  const parameters: Parameter[] = [];
  const unusedParameters: string[] = [];

  for (let i = 0; i < node.parameters.length; i++) {
    const param = node.parameters[i];
    const paramInfo = extractSingleParam(param, i, checker, sourceFile, node);
    parameters.push(paramInfo);
    if (!paramInfo.isUsed) {
      unusedParameters.push(paramInfo.name);
    }
  }

  return { parameters, unusedParameters };
}

function extractSingleParam(
  param: ts.ParameterDeclaration,
  position: number,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  funcNode: ts.FunctionLikeDeclaration
): Parameter {
  const name = getParamName(param);
  const type = getParamType(param, checker);

  // Skip _ prefixed params (intentionally unused convention)
  if (name.startsWith('_')) {
    return { name, type, isUsed: true, position };
  }

  const isUsed = isParameterUsed(param, funcNode);

  return { name, type, isUsed, position };
}

function getParamName(param: ts.ParameterDeclaration): string {
  const name = param.name;
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.getText();
  }
  return String(name);
}

function getParamType(param: ts.ParameterDeclaration, checker: ts.TypeChecker): string | null {
  if (param.type) {
    return param.type.getText();
  }
  try {
    const symbol = checker.getSymbolAtLocation(param.name);
    if (symbol) {
      const type = checker.getTypeOfSymbolAtLocation(symbol, param);
      return checker.typeToString(type);
    }
  } catch {
    // Type resolution may fail
  }
  return null;
}

/**
 * Check if a parameter is referenced anywhere in the function body.
 * Handles regular params, destructured params, and rest params.
 */
function isParameterUsed(
  param: ts.ParameterDeclaration,
  funcNode: ts.FunctionLikeDeclaration
): boolean {
  if (!funcNode.body) return true; // No body = assume used (declaration only)

  if (ts.isObjectBindingPattern(param.name) || ts.isArrayBindingPattern(param.name)) {
    return isDestructuredParamUsed(param.name, funcNode.body);
  }

  if (ts.isIdentifier(param.name)) {
    return isIdentifierUsedInBody(param.name.text, funcNode.body);
  }

  return true; // Assume used if we can't determine
}

/** Check if any binding in a destructuring pattern is used */
function isDestructuredParamUsed(
  pattern: ts.ObjectBindingPattern | ts.ArrayBindingPattern,
  body: ts.Node
): boolean {
  for (const element of pattern.elements) {
    if (ts.isBindingElement(element)) {
      if (ts.isIdentifier(element.name)) {
        if (element.name.text.startsWith('_')) continue;
        if (isIdentifierUsedInBody(element.name.text, body)) {
          return true;
        }
      } else if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
        if (isDestructuredParamUsed(element.name, body)) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Check if an identifier name appears in the function body */
function isIdentifierUsedInBody(name: string, body: ts.Node): boolean {
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) {
      // Make sure this isn't a property name in a property access (obj.name doesn't count as using `name`)
      const parent = node.parent;
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) {
        // This is obj.name — check if `obj` part equals our param name
        // Actually this IS a property name, not a reference to our variable
        return;
      }
      // It's not just a declaration or the parameter itself
      if (parent && ts.isParameter(parent) && parent.name === node) {
        return;
      }
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(body, visit);
  return found;
}
