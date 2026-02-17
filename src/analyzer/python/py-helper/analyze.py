#!/usr/bin/env python3
"""
Python AST analyzer for CodeGraph.
Parses Python source files, extracts function/method definitions,
resolves calls, and detects unused parameters.

Input: JSON on stdin with { "files": [...], "projectRoot": "..." }
Output: JSON on stdout with { "nodes": [...], "edges": [...] }
"""

import ast
import json
import os
import sys
from typing import Any


def analyze_files(files: list[str], project_root: str) -> dict:
    nodes: list[dict] = []
    edges: list[dict] = []

    # First pass: collect all function definitions
    func_map: dict[str, dict] = {}  # qualified_name -> node info
    module_funcs: dict[str, list[str]] = {}  # module -> list of func names

    for file_path in files:
        abs_path = os.path.join(project_root, file_path)
        if not os.path.exists(abs_path):
            continue
        try:
            with open(abs_path, "r", encoding="utf-8") as f:
                source = f.read()
            tree = ast.parse(source, filename=file_path)
        except (SyntaxError, UnicodeDecodeError):
            continue

        file_nodes = extract_nodes(tree, file_path, source)
        for node in file_nodes:
            nodes.append(node)
            func_map[node["id"]] = node
            func_map[node["name"]] = node  # Also by short name for resolution

            module = node["packageOrModule"]
            if module not in module_funcs:
                module_funcs[module] = []
            module_funcs[module].append(node["name"])

    # Second pass: resolve calls
    for file_path in files:
        abs_path = os.path.join(project_root, file_path)
        if not os.path.exists(abs_path):
            continue
        try:
            with open(abs_path, "r", encoding="utf-8") as f:
                source = f.read()
            tree = ast.parse(source, filename=file_path)
        except (SyntaxError, UnicodeDecodeError):
            continue

        file_edges = extract_edges(tree, file_path, func_map)
        edges.extend(file_edges)

    return {"nodes": nodes, "edges": edges}


def extract_nodes(tree: ast.Module, file_path: str, source: str) -> list[dict]:
    nodes = []
    lines = source.split("\n")
    module = os.path.dirname(file_path) or "."

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            parent_class = get_parent_class(tree, node)
            kind = "method" if parent_class else "function"
            if node.name == "__init__":
                kind = "constructor"

            qualified = f"{parent_class}.{node.name}" if parent_class else node.name
            node_id = f"{file_path}:{qualified}"

            # Determine visibility
            visibility = "module"
            if not node.name.startswith("_"):
                visibility = "exported"
            elif node.name.startswith("__") and not node.name.endswith("__"):
                visibility = "private"

            # Extract and check parameters
            params, unused_params = check_parameters(node, parent_class is not None)

            # Check for decorator-based entry points
            is_entry = False
            decorators = []
            for dec in node.decorator_list:
                dec_name = get_decorator_name(dec)
                if dec_name:
                    decorators.append(dec_name)
                    if any(
                        ep in dec_name
                        for ep in ["route", "get", "post", "put", "delete", "command", "task"]
                    ):
                        is_entry = True

            start_line = node.lineno
            end_line = node.end_lineno or node.lineno

            nodes.append(
                {
                    "id": node_id,
                    "name": node.name,
                    "qualifiedName": f"{file_path}:{qualified}",
                    "filePath": file_path,
                    "startLine": start_line,
                    "endLine": end_line,
                    "language": "python",
                    "kind": kind,
                    "visibility": visibility,
                    "isEntryPoint": is_entry,
                    "parameters": params,
                    "unusedParameters": unused_params,
                    "packageOrModule": module,
                    "linesOfCode": end_line - start_line + 1,
                    "status": "dead",
                    "color": "red",
                    "decorators": decorators,
                }
            )

    return nodes


def check_parameters(
    func: ast.FunctionDef | ast.AsyncFunctionDef, is_method: bool
) -> tuple[list[dict], list[str]]:
    params: list[dict] = []
    unused: list[str] = []

    # Collect all parameter names
    all_args = (
        func.args.args
        + func.args.posonlyargs
        + func.args.kwonlyargs
    )
    if func.args.vararg:
        all_args_with_special = list(all_args) + [func.args.vararg]
    else:
        all_args_with_special = list(all_args)
    if func.args.kwarg:
        all_args_with_special = list(all_args_with_special) + [func.args.kwarg]

    # Get all names used in the function body
    used_names = set()
    for node in ast.walk(func):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            used_names.add(node.id)

    for i, arg in enumerate(all_args_with_special):
        name = arg.arg
        type_str = None
        if arg.annotation:
            try:
                type_str = ast.unparse(arg.annotation)
            except Exception:
                pass

        # Skip self/cls
        if i == 0 and is_method and name in ("self", "cls"):
            params.append(
                {"name": name, "type": type_str, "isUsed": True, "position": i}
            )
            continue

        # Skip _ prefixed
        if name.startswith("_"):
            params.append(
                {"name": name, "type": type_str, "isUsed": True, "position": i}
            )
            continue

        is_used = name in used_names
        params.append(
            {"name": name, "type": type_str, "isUsed": is_used, "position": i}
        )
        if not is_used:
            unused.append(name)

    return params, unused


def extract_edges(
    tree: ast.Module, file_path: str, func_map: dict[str, dict]
) -> list[dict]:
    edges = []

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        parent_class = get_parent_class(tree, node)
        qualified = f"{parent_class}.{node.name}" if parent_class else node.name
        source_id = f"{file_path}:{qualified}"

        # Walk the function body for calls
        for child in ast.walk(node):
            if isinstance(child, ast.Call):
                target_name = get_call_target_name(child)
                if not target_name:
                    continue

                # Skip built-in and common stdlib functions
                if target_name in BUILTIN_FUNCTIONS:
                    continue

                # Try to resolve
                target_id = None
                kind = "direct"

                # Direct resolution by full id
                if f"{file_path}:{target_name}" in func_map:
                    target_id = f"{file_path}:{target_name}"
                elif target_name in func_map:
                    target_id = func_map[target_name]["id"]

                # Method calls
                if "." in target_name:
                    parts = target_name.rsplit(".", 1)
                    method_name = parts[1]
                    kind = "method"
                    # Try to find method by name in any class
                    for fid, finfo in func_map.items():
                        if finfo["name"] == method_name and finfo["kind"] == "method":
                            target_id = finfo["id"]
                            break

                # Constructor calls (class name = __init__)
                init_key = f"{file_path}:{target_name}.__init__"
                if not target_id and init_key in func_map:
                    target_id = init_key
                    kind = "constructor"

                if target_id and target_id != source_id:
                    edges.append(
                        {
                            "source": source_id,
                            "target": target_id,
                            "callSite": {
                                "filePath": file_path,
                                "line": child.lineno,
                                "column": child.col_offset + 1,
                            },
                            "kind": kind,
                            "isResolved": True,
                        }
                    )

    return edges


def get_call_target_name(call: ast.Call) -> str | None:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        value_name = None
        if isinstance(func.value, ast.Name):
            value_name = func.value.id
        elif isinstance(func.value, ast.Call):
            # Chained call, just get the method name
            return func.attr
        if value_name:
            return f"{value_name}.{func.attr}"
        return func.attr
    return None


def get_parent_class(
    tree: ast.Module, target: ast.FunctionDef | ast.AsyncFunctionDef
) -> str | None:
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for child in node.body:
                if child is target:
                    return node.name
    return None


def get_decorator_name(dec: ast.expr) -> str | None:
    if isinstance(dec, ast.Name):
        return dec.id
    if isinstance(dec, ast.Attribute):
        if isinstance(dec.value, ast.Name):
            return f"{dec.value.id}.{dec.attr}"
        return dec.attr
    if isinstance(dec, ast.Call):
        return get_decorator_name(dec.func)
    return None


BUILTIN_FUNCTIONS = {
    "print",
    "len",
    "range",
    "str",
    "int",
    "float",
    "bool",
    "list",
    "dict",
    "set",
    "tuple",
    "type",
    "isinstance",
    "issubclass",
    "hasattr",
    "getattr",
    "setattr",
    "delattr",
    "id",
    "hash",
    "repr",
    "sorted",
    "reversed",
    "enumerate",
    "zip",
    "map",
    "filter",
    "any",
    "all",
    "min",
    "max",
    "sum",
    "abs",
    "round",
    "input",
    "open",
    "super",
    "property",
    "staticmethod",
    "classmethod",
    "ValueError",
    "TypeError",
    "KeyError",
    "IndexError",
    "RuntimeError",
    "Exception",
    "NotImplementedError",
    "AttributeError",
    "OSError",
    "IOError",
    "StopIteration",
    "next",
    "iter",
    "callable",
    "vars",
    "dir",
    "globals",
    "locals",
    "exec",
    "eval",
    "compile",
    "format",
    "chr",
    "ord",
    "hex",
    "oct",
    "bin",
    "pow",
    "divmod",
    "complex",
    "bytes",
    "bytearray",
    "memoryview",
    "frozenset",
    "object",
    "breakpoint",
}


def main():
    input_data = json.loads(sys.stdin.read())
    files = input_data["files"]
    project_root = input_data["projectRoot"]

    result = analyze_files(files, project_root)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
