// Package main implements a Go static analysis helper for CodeGraph.
// It reads a JSON configuration from stdin and outputs function nodes
// and call edges as JSON to stdout.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
)

type Input struct {
	Files       []string `json:"files"`
	ProjectRoot string   `json:"projectRoot"`
	Module      string   `json:"module"`
}

type Parameter struct {
	Name     string  `json:"name"`
	Type     *string `json:"type"`
	IsUsed   bool    `json:"isUsed"`
	Position int     `json:"position"`
}

type Node struct {
	ID               string      `json:"id"`
	Name             string      `json:"name"`
	QualifiedName    string      `json:"qualifiedName"`
	FilePath         string      `json:"filePath"`
	StartLine        int         `json:"startLine"`
	EndLine          int         `json:"endLine"`
	Language         string      `json:"language"`
	Kind             string      `json:"kind"`
	Visibility       string      `json:"visibility"`
	IsEntryPoint     bool        `json:"isEntryPoint"`
	Parameters       []Parameter `json:"parameters"`
	UnusedParameters []string    `json:"unusedParameters"`
	PackageOrModule  string      `json:"packageOrModule"`
	LinesOfCode      int         `json:"linesOfCode"`
	Status           string      `json:"status"`
	Color            string      `json:"color"`
}

type CallSite struct {
	FilePath string `json:"filePath"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
}

type Edge struct {
	Source     string   `json:"source"`
	Target     string   `json:"target"`
	CallSite   CallSite `json:"callSite"`
	Kind       string   `json:"kind"`
	IsResolved bool     `json:"isResolved"`
}

type Output struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

// builtins that should be skipped
var goBuiltins = map[string]bool{
	"make": true, "len": true, "cap": true, "append": true, "copy": true,
	"delete": true, "close": true, "new": true, "panic": true, "recover": true,
	"print": true, "println": true, "complex": true, "real": true, "imag": true,
	"clear": true, "min": true, "max": true,
}

func main() {
	var input Input
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read input: %v\n", err)
		os.Exit(1)
	}

	output := analyzeFiles(input)
	if err := json.NewEncoder(os.Stdout).Encode(output); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write output: %v\n", err)
		os.Exit(1)
	}
}

func analyzeFiles(input Input) Output {
	fset := token.NewFileSet()
	var allNodes []Node
	var allEdges []Edge
	funcMap := make(map[string]*Node) // name -> node for resolution

	// First pass: collect all function declarations
	for _, filePath := range input.Files {
		absPath := filepath.Join(input.ProjectRoot, filePath)
		f, err := parser.ParseFile(fset, absPath, nil, parser.ParseComments)
		if err != nil {
			continue
		}

		pkgName := f.Name.Name
		nodes := extractNodes(f, fset, filePath, pkgName)

		for i := range nodes {
			allNodes = append(allNodes, nodes[i])
			funcMap[nodes[i].ID] = &allNodes[len(allNodes)-1]
			funcMap[nodes[i].Name] = &allNodes[len(allNodes)-1]
		}
	}

	// Second pass: resolve calls
	for _, filePath := range input.Files {
		absPath := filepath.Join(input.ProjectRoot, filePath)
		f, err := parser.ParseFile(fset, absPath, nil, 0)
		if err != nil {
			continue
		}

		pkgName := f.Name.Name
		edges := extractEdges(f, fset, filePath, pkgName, funcMap)
		allEdges = append(allEdges, edges...)
	}

	if allNodes == nil {
		allNodes = []Node{}
	}
	if allEdges == nil {
		allEdges = []Edge{}
	}

	return Output{Nodes: allNodes, Edges: allEdges}
}

func extractNodes(f *ast.File, fset *token.FileSet, filePath, pkgName string) []Node {
	var nodes []Node

	for _, decl := range f.Decls {
		funcDecl, ok := decl.(*ast.FuncDecl)
		if !ok {
			continue
		}

		name := funcDecl.Name.Name
		kind := "function"
		var receiver string

		if funcDecl.Recv != nil && len(funcDecl.Recv.List) > 0 {
			kind = "method"
			receiver = getReceiverTypeName(funcDecl.Recv.List[0].Type)
		}

		qualified := name
		if receiver != "" {
			qualified = receiver + "." + name
		}

		nodeID := filePath + ":" + qualified

		// Visibility
		visibility := "module"
		if ast.IsExported(name) {
			visibility = "exported"
		}

		// Auto entry points
		isEntry := false
		if name == "main" && pkgName == "main" {
			isEntry = true
		}
		if name == "init" {
			isEntry = true
		}
		if strings.HasPrefix(name, "Test") || strings.HasPrefix(name, "Benchmark") || strings.HasPrefix(name, "Example") {
			isEntry = true
		}

		startPos := fset.Position(funcDecl.Pos())
		endPos := fset.Position(funcDecl.End())

		params, unusedParams := checkParameters(funcDecl)

		pkg := filepath.Dir(filePath)
		if pkg == "." {
			pkg = pkgName
		}

		nodes = append(nodes, Node{
			ID:               nodeID,
			Name:             name,
			QualifiedName:    filePath + ":" + qualified,
			FilePath:         filePath,
			StartLine:        startPos.Line,
			EndLine:          endPos.Line,
			Language:         "go",
			Kind:             kind,
			Visibility:       visibility,
			IsEntryPoint:     isEntry,
			Parameters:       params,
			UnusedParameters: unusedParams,
			PackageOrModule:  pkg,
			LinesOfCode:      endPos.Line - startPos.Line + 1,
			Status:           "dead",
			Color:            "red",
		})
	}

	return nodes
}

func checkParameters(funcDecl *ast.FuncDecl) ([]Parameter, []string) {
	if funcDecl.Type.Params == nil {
		return []Parameter{}, []string{}
	}

	// Collect all identifier references in the function body
	usedNames := make(map[string]bool)
	if funcDecl.Body != nil {
		ast.Inspect(funcDecl.Body, func(n ast.Node) bool {
			if ident, ok := n.(*ast.Ident); ok {
				usedNames[ident.Name] = true
			}
			return true
		})
	}

	var params []Parameter
	var unused []string
	pos := 0

	for _, field := range funcDecl.Type.Params.List {
		typeStr := formatFieldType(field)

		if len(field.Names) == 0 {
			// Unnamed parameter
			params = append(params, Parameter{
				Name:     "_",
				Type:     &typeStr,
				IsUsed:   true,
				Position: pos,
			})
			pos++
			continue
		}

		for _, name := range field.Names {
			pName := name.Name
			isUsed := true

			if pName == "_" {
				// Intentionally unused
			} else if funcDecl.Body == nil {
				// No body, assume used (interface method)
			} else {
				isUsed = usedNames[pName]
			}

			params = append(params, Parameter{
				Name:     pName,
				Type:     &typeStr,
				IsUsed:   isUsed,
				Position: pos,
			})

			if !isUsed && pName != "_" {
				unused = append(unused, pName)
			}
			pos++
		}
	}

	if unused == nil {
		unused = []string{}
	}

	return params, unused
}

func extractEdges(f *ast.File, fset *token.FileSet, filePath, pkgName string, funcMap map[string]*Node) []Edge {
	var edges []Edge

	for _, decl := range f.Decls {
		funcDecl, ok := decl.(*ast.FuncDecl)
		if !ok || funcDecl.Body == nil {
			continue
		}

		name := funcDecl.Name.Name
		var receiver string
		if funcDecl.Recv != nil && len(funcDecl.Recv.List) > 0 {
			receiver = getReceiverTypeName(funcDecl.Recv.List[0].Type)
		}

		qualified := name
		if receiver != "" {
			qualified = receiver + "." + name
		}
		sourceID := filePath + ":" + qualified

		ast.Inspect(funcDecl.Body, func(n ast.Node) bool {
			callExpr, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}

			targetName := getCallTargetName(callExpr)
			if targetName == "" || goBuiltins[targetName] {
				return true
			}

			kind := "direct"

			// Try to resolve
			var targetID string

			// Full path resolution
			fullID := filePath + ":" + targetName
			if node, exists := funcMap[fullID]; exists {
				targetID = node.ID
			} else if node, exists := funcMap[targetName]; exists {
				targetID = node.ID
			}

			if strings.Contains(targetName, ".") {
				kind = "method"
			}

			if targetID != "" && targetID != sourceID {
				pos := fset.Position(callExpr.Pos())
				edges = append(edges, Edge{
					Source: sourceID,
					Target: targetID,
					CallSite: CallSite{
						FilePath: filePath,
						Line:     pos.Line,
						Column:   pos.Column,
					},
					Kind:       kind,
					IsResolved: true,
				})
			}

			return true
		})
	}

	return edges
}

func getCallTargetName(call *ast.CallExpr) string {
	switch fn := call.Fun.(type) {
	case *ast.Ident:
		return fn.Name
	case *ast.SelectorExpr:
		if ident, ok := fn.X.(*ast.Ident); ok {
			return ident.Name + "." + fn.Sel.Name
		}
		return fn.Sel.Name
	}
	return ""
}

func getReceiverTypeName(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		if ident, ok := t.X.(*ast.Ident); ok {
			return ident.Name
		}
	}
	return ""
}

func formatFieldType(field *ast.Field) string {
	if field.Type == nil {
		return ""
	}
	switch t := field.Type.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		if ident, ok := t.X.(*ast.Ident); ok {
			return "*" + ident.Name
		}
	case *ast.ArrayType:
		if ident, ok := t.Elt.(*ast.Ident); ok {
			return "[]" + ident.Name
		}
	case *ast.MapType:
		return "map"
	case *ast.InterfaceType:
		return "interface{}"
	case *ast.SelectorExpr:
		if ident, ok := t.X.(*ast.Ident); ok {
			return ident.Name + "." + t.Sel.Name
		}
	}
	return "unknown"
}
