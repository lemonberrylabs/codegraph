// Package main implements a Go static analysis helper for CodeGraph.
// It reads a JSON configuration from stdin and outputs function nodes
// and call edges as JSON to stdout.
//
// Primary mode: type-aware analysis using golang.org/x/tools/go/packages
// with interface dispatch resolution.
// Fallback mode: AST-only analysis (no type info, no interface dispatch).
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/tools/go/packages"
)

// ---------- JSON types (unchanged) ----------

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

	output, err := analyzeWithTypes(input)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Type-aware analysis unavailable, using AST fallback: %v\n", err)
		output = analyzeFilesASTOnly(input)
	}

	if err := json.NewEncoder(os.Stdout).Encode(output); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write output: %v\n", err)
		os.Exit(1)
	}
}

// ===================================================================
// Type-aware analysis (primary path)
// ===================================================================

func analyzeWithTypes(input Input) (Output, error) {
	cfg := &packages.Config{
		Mode: packages.NeedName |
			packages.NeedFiles |
			packages.NeedCompiledGoFiles |
			packages.NeedSyntax |
			packages.NeedTypes |
			packages.NeedTypesInfo,
		Dir: input.ProjectRoot,
	}

	pkgs, err := packages.Load(cfg, "./...")
	if err != nil {
		return Output{}, err
	}

	// Log package-level errors but continue processing
	for _, pkg := range pkgs {
		for _, e := range pkg.Errors {
			fmt.Fprintf(os.Stderr, "Warning: package %s: %v\n", pkg.PkgPath, e)
		}
	}

	absRoot, _ := filepath.Abs(input.ProjectRoot)
	projectPkgs := filterProjectPackages(pkgs, absRoot)
	if len(projectPkgs) == 0 {
		return Output{}, fmt.Errorf("no project packages found under %s", absRoot)
	}

	// Phase 1: Extract nodes from all project packages
	objToNodeID := make(map[types.Object]string)
	var allNodes []Node

	for _, pkg := range projectPkgs {
		for i, file := range pkg.Syntax {
			absPath := pkg.CompiledGoFiles[i]
			relPath, err := filepath.Rel(absRoot, absPath)
			if err != nil {
				continue
			}

			for _, decl := range file.Decls {
				funcDecl, ok := decl.(*ast.FuncDecl)
				if !ok {
					continue
				}

				obj := pkg.TypesInfo.Defs[funcDecl.Name]
				if obj == nil {
					continue
				}
				funcObj, ok := obj.(*types.Func)
				if !ok {
					continue
				}

				node := buildNodeTyped(funcDecl, pkg.Fset, relPath, pkg.Name, funcObj)
				allNodes = append(allNodes, node)
				objToNodeID[funcObj] = node.ID
			}
		}
	}

	// Phase 2: Collect all concrete named types for interface dispatch
	var concreteTypes []*types.Named
	for _, pkg := range projectPkgs {
		scope := pkg.Types.Scope()
		for _, name := range scope.Names() {
			obj := scope.Lookup(name)
			tn, ok := obj.(*types.TypeName)
			if !ok {
				continue
			}
			named, ok := tn.Type().(*types.Named)
			if !ok {
				continue
			}
			if types.IsInterface(named) {
				continue
			}
			concreteTypes = append(concreteTypes, named)
		}
	}

	// allEdges collects edges from all phases (2b var-init + 3 call resolution)
	var allEdges []Edge

	// Phase 2b: Scan package-level var/const declarations for function references.
	// This handles DI patterns like: var Module = fx.Options(fx.Provide(constructor))
	// where constructor references are invisible to function-body scanning.
	for _, pkg := range projectPkgs {
		for i, file := range pkg.Syntax {
			absPath := pkg.CompiledGoFiles[i]
			relPath, err := filepath.Rel(absRoot, absPath)
			if err != nil {
				continue
			}

			var varInitTargets []string // node IDs referenced in var/const inits
			seen := make(map[string]bool)

			for _, decl := range file.Decls {
				genDecl, ok := decl.(*ast.GenDecl)
				if !ok {
					continue
				}
				if genDecl.Tok != token.VAR && genDecl.Tok != token.CONST {
					continue
				}

				for _, spec := range genDecl.Specs {
					valSpec, ok := spec.(*ast.ValueSpec)
					if !ok {
						continue
					}

					for _, valExpr := range valSpec.Values {
						ast.Inspect(valExpr, func(n ast.Node) bool {
							switch node := n.(type) {
							case *ast.Ident:
								if goBuiltins[node.Name] {
									return true
								}
								obj := pkg.TypesInfo.Uses[node]
								if obj == nil {
									return true
								}
								funcObj, ok := obj.(*types.Func)
								if !ok {
									return true
								}
								targetID, ok := objToNodeID[funcObj]
								if !ok {
									return true
								}
								if !seen[targetID] {
									seen[targetID] = true
									varInitTargets = append(varInitTargets, targetID)
	
								}

							case *ast.SelectorExpr:
								// pkg.Func or x.Method references
								selObj := pkg.TypesInfo.Uses[node.Sel]
								if selObj == nil {
									return true
								}
								funcObj, ok := selObj.(*types.Func)
								if !ok {
									return true
								}
								targetID, ok := objToNodeID[funcObj]
								if !ok {
									return true
								}
								if !seen[targetID] {
									seen[targetID] = true
									varInitTargets = append(varInitTargets, targetID)
	
								}
								return false // don't recurse into X
							}
							return true
						})
					}
				}
			}

			if len(varInitTargets) > 0 {
				// Create synthetic __var_init__ node for this file
				syntheticID := relPath + ":__var_init__"
				syntheticNode := Node{
					ID:               syntheticID,
					Name:             "__var_init__",
					QualifiedName:    relPath + ":__var_init__",
					FilePath:         relPath,
					StartLine:        1,
					EndLine:          1,
					Language:         "go",
					Kind:             "init",
					Visibility:       "module",
					IsEntryPoint:     true,
					Parameters:       []Parameter{},
					UnusedParameters: []string{},
					PackageOrModule:  filepath.Dir(relPath),
					LinesOfCode:      1,
					Status:           "entry",
					Color:            "blue",
				}
				if syntheticNode.PackageOrModule == "." {
					syntheticNode.PackageOrModule = pkg.Name
				}
				allNodes = append(allNodes, syntheticNode)

				// Create edges from synthetic node to each referenced function
				for _, targetID := range varInitTargets {
					allEdges = append(allEdges, Edge{
						Source: syntheticID,
						Target: targetID,
						CallSite: CallSite{
							FilePath: relPath,
							Line:     1,
							Column:   1,
						},
						Kind:       "varinit",
						IsResolved: true,
					})
				}

				}
		}
	}

	// Phase 2c: For every function (constructor) that returns a named type,
	// create edges from the function to all methods on the returned type.
	// This models the Go constructor pattern: if NewFoo() returns *Foo or FooInterface,
	// and NewFoo is reachable, then methods on the returned type are callable.
	// For interface return types, fan out to all concrete implementations' methods.
	for obj, nodeID := range objToNodeID {
		funcObj, ok := obj.(*types.Func)
		if !ok {
			continue
		}
		sig, ok := funcObj.Type().(*types.Signature)
		if !ok {
			continue
		}
		// Skip methods — only process standalone functions (constructors)
		if sig.Recv() != nil {
			continue
		}
		results := sig.Results()
		for ri := 0; ri < results.Len(); ri++ {
			returnType := results.At(ri).Type()
			// Unwrap pointer
			if ptr, ok := returnType.(*types.Pointer); ok {
				returnType = ptr.Elem()
			}
			named, ok := returnType.(*types.Named)
			if !ok {
				continue
			}

			if iface, isIface := named.Underlying().(*types.Interface); isIface {
				// Return type is an interface — fan out to all concrete implementations
				addMethodEdgesForInterface(nodeID, iface, concreteTypes, objToNodeID, &allEdges)
			} else {
				// Return type is a concrete type — add direct method edges
				addMethodEdgesForType(nodeID, named, objToNodeID, &allEdges)
			}
		}
	}

	// Cache for interface method → concrete implementations
	ifaceImplCache := make(map[*types.Func][]*types.Func)

	// Phase 3: Resolve calls with type information

	for _, pkg := range projectPkgs {
		for i, file := range pkg.Syntax {
			absPath := pkg.CompiledGoFiles[i]
			relPath, err := filepath.Rel(absRoot, absPath)
			if err != nil {
				continue
			}

			for _, decl := range file.Decls {
				funcDecl, ok := decl.(*ast.FuncDecl)
				if !ok || funcDecl.Body == nil {
					continue
				}

				sourceObj := pkg.TypesInfo.Defs[funcDecl.Name]
				if sourceObj == nil {
					continue
				}
				sourceID := objToNodeID[sourceObj]
				if sourceID == "" {
					continue
				}

				edges := resolveCallsTyped(funcDecl, pkg, relPath, sourceID,
					objToNodeID, concreteTypes, ifaceImplCache)
				allEdges = append(allEdges, edges...)
			}
		}
	}

	if allNodes == nil {
		allNodes = []Node{}
	}
	if allEdges == nil {
		allEdges = []Edge{}
	}

	return Output{Nodes: allNodes, Edges: allEdges}, nil
}

// filterProjectPackages keeps only packages whose files reside under the project root.
func filterProjectPackages(pkgs []*packages.Package, absRoot string) []*packages.Package {
	var result []*packages.Package
	for _, pkg := range pkgs {
		files := pkg.CompiledGoFiles
		if len(files) == 0 {
			files = pkg.GoFiles
		}
		for _, f := range files {
			if strings.HasPrefix(f, absRoot) {
				result = append(result, pkg)
				break
			}
		}
	}
	return result
}

// buildNodeTyped creates a Node using typed function information.
func buildNodeTyped(funcDecl *ast.FuncDecl, fset *token.FileSet, relPath, pkgName string, funcObj *types.Func) Node {
	name := funcDecl.Name.Name
	kind := "function"
	var receiver string

	sig := funcObj.Type().(*types.Signature)
	if sig.Recv() != nil {
		kind = "method"
		receiver = getReceiverTypeName(funcDecl.Recv.List[0].Type)
	}

	qualified := name
	if receiver != "" {
		qualified = receiver + "." + name
	}

	nodeID := relPath + ":" + qualified

	visibility := "module"
	if ast.IsExported(name) {
		visibility = "exported"
	}

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

	params, unusedParams := checkParametersTyped(funcDecl, sig)

	pkg := filepath.Dir(relPath)
	if pkg == "." {
		pkg = pkgName
	}

	return Node{
		ID:               nodeID,
		Name:             name,
		QualifiedName:    relPath + ":" + qualified,
		FilePath:         relPath,
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
	}
}

// checkParametersTyped extracts parameters using the type-checked signature.
func checkParametersTyped(funcDecl *ast.FuncDecl, sig *types.Signature) ([]Parameter, []string) {
	sigParams := sig.Params()
	if sigParams.Len() == 0 {
		return []Parameter{}, []string{}
	}

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

	for i := 0; i < sigParams.Len(); i++ {
		v := sigParams.At(i)
		pName := v.Name()
		typeStr := simplifyType(v.Type().String())

		isUsed := true
		if pName == "" || pName == "_" {
			pName = "_"
		} else if funcDecl.Body == nil {
			// interface method — assume used
		} else {
			isUsed = usedNames[pName]
		}

		params = append(params, Parameter{
			Name:     pName,
			Type:     &typeStr,
			IsUsed:   isUsed,
			Position: i,
		})

		if !isUsed && pName != "_" {
			unused = append(unused, pName)
		}
	}

	if unused == nil {
		unused = []string{}
	}

	return params, unused
}

// simplifyType strips full package paths from a type string.
// "github.com/foo/bar.Handler" → "bar.Handler"
// "*github.com/foo/bar.Handler" → "*bar.Handler"
func simplifyType(s string) string {
	var result strings.Builder
	i := 0
	for i < len(s) {
		j := i
		for j < len(s) {
			c := s[j]
			if c == '/' {
				// Package path separator — skip the segment before it
				i = j + 1
				break
			}
			if c == ' ' || c == '[' || c == ']' || c == '(' || c == ')' || c == ',' || c == '*' {
				// Stop character — copy segment including this char
				result.WriteString(s[i : j+1])
				i = j + 1
				break
			}
			j++
		}
		if j >= len(s) {
			result.WriteString(s[i:])
			break
		}
	}
	return result.String()
}

// resolveCallsTyped walks a function body and resolves calls AND function/method
// value references using type information. This handles patterns like:
//   - Direct calls: foo(), x.Method(), pkg.Func()
//   - Interface dispatch: ifaceVar.Method() → all concrete implementations
//   - Method value refs: withProfile(ctrl.handleGetMe) → edge to handleGetMe
//   - Function value refs: register(myHandler) → edge to myHandler
func resolveCallsTyped(
	funcDecl *ast.FuncDecl,
	pkg *packages.Package,
	relPath, sourceID string,
	objToNodeID map[types.Object]string,
	concreteTypes []*types.Named,
	ifaceImplCache map[*types.Func][]*types.Func,
) []Edge {
	var edges []Edge
	seen := make(map[string]bool) // deduplicate edges by "source->target"

	addEdge := func(target string, pos token.Position, kind string) {
		key := sourceID + "->" + target
		if seen[key] {
			return
		}
		seen[key] = true
		edges = append(edges, Edge{
			Source: sourceID,
			Target: target,
			CallSite: CallSite{
				FilePath: relPath,
				Line:     pos.Line,
				Column:   pos.Column,
			},
			Kind:       kind,
			IsResolved: true,
		})
	}

	// Track which SelectorExprs are call targets (handled in the call path)
	callFuncs := make(map[ast.Node]bool)
	ast.Inspect(funcDecl.Body, func(n ast.Node) bool {
		if ce, ok := n.(*ast.CallExpr); ok {
			callFuncs[ce.Fun] = true
		}
		return true
	})

	ast.Inspect(funcDecl.Body, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.CallExpr:
			// Handle function/method calls
			switch fn := node.Fun.(type) {
			case *ast.Ident:
				// Plain function call: foo()
				if goBuiltins[fn.Name] {
					return true
				}
				obj := pkg.TypesInfo.Uses[fn]
				if obj == nil {
					return true
				}
				funcObj, ok := obj.(*types.Func)
				if !ok {
					return true
				}
				targetID, ok := objToNodeID[funcObj]
				if !ok || targetID == sourceID {
					return true
				}
				addEdge(targetID, pkg.Fset.Position(node.Pos()), "direct")

			case *ast.SelectorExpr:
				// x.Method() or pkg.Func()
				if goBuiltins[fn.Sel.Name] {
					return true
				}

				// Check if this is a package-qualified call (pkg.Func)
				if ident, ok := fn.X.(*ast.Ident); ok {
					xObj := pkg.TypesInfo.Uses[ident]
					if _, isPkg := xObj.(*types.PkgName); isPkg {
						selObj := pkg.TypesInfo.Uses[fn.Sel]
						if selObj == nil {
							return true
						}
						funcObj, ok := selObj.(*types.Func)
						if !ok {
							return true
						}
						targetID, ok := objToNodeID[funcObj]
						if !ok || targetID == sourceID {
							return true
						}
						addEdge(targetID, pkg.Fset.Position(node.Pos()), "direct")
						return true
					}
				}

				// Method call: x.Method()
				selection, ok := pkg.TypesInfo.Selections[fn]
				if !ok {
					return true
				}

				methodObj, ok := selection.Obj().(*types.Func)
				if !ok {
					return true
				}

				// Check if receiver is an interface type
				recvType := selection.Recv()
				if ptr, ok := recvType.(*types.Pointer); ok {
					recvType = ptr.Elem()
				}

				if iface, isIface := recvType.Underlying().(*types.Interface); isIface {
					// Interface method call — fan out to all concrete implementations
					impls := resolveIfaceImpls(methodObj, iface, concreteTypes, objToNodeID, ifaceImplCache)
					for _, impl := range impls {
						targetID, ok := objToNodeID[impl]
						if !ok || targetID == sourceID {
							continue
						}
						addEdge(targetID, pkg.Fset.Position(node.Pos()), "interface")
					}
				} else {
					// Concrete method call
					targetID, ok := objToNodeID[methodObj]
					if !ok || targetID == sourceID {
						return true
					}
					addEdge(targetID, pkg.Fset.Position(node.Pos()), "method")
				}
			}

		case *ast.SelectorExpr:
			// Method/function value reference (not a call): ctrl.handleGetMe
			// This handles patterns like: withProfile(ctrl.handleGetMe)
			// where handleGetMe is passed as a value, not invoked.
			if callFuncs[node] {
				return true // Already handled as a call target above
			}

			selection, ok := pkg.TypesInfo.Selections[node]
			if !ok {
				return true
			}

			// Only track method values (MethodVal), not field access
			if selection.Kind() != types.MethodVal {
				return true
			}

			methodObj, ok := selection.Obj().(*types.Func)
			if !ok {
				return true
			}

			targetID, ok := objToNodeID[methodObj]
			if !ok || targetID == sourceID {
				return true
			}
			addEdge(targetID, pkg.Fset.Position(node.Pos()), "funcref")

		case *ast.Ident:
			// Function value reference (not a call): passed as argument
			// e.g., register(myHandler) where myHandler is a package-level func
			if callFuncs[node] {
				return true // Already handled as a call target above
			}
			if goBuiltins[node.Name] {
				return true
			}

			obj := pkg.TypesInfo.Uses[node]
			if obj == nil {
				return true
			}
			funcObj, ok := obj.(*types.Func)
			if !ok {
				return true
			}
			targetID, ok := objToNodeID[funcObj]
			if !ok || targetID == sourceID {
				return true
			}
			addEdge(targetID, pkg.Fset.Position(node.Pos()), "funcref")
		}

		return true
	})

	return edges
}

// addMethodEdgesForType creates edges from sourceID to all methods on a concrete named type.
func addMethodEdgesForType(sourceID string, named *types.Named, objToNodeID map[types.Object]string, edges *[]Edge) {
	mset := types.NewMethodSet(types.NewPointer(named))
	for mi := 0; mi < mset.Len(); mi++ {
		methodFunc, ok := mset.At(mi).Obj().(*types.Func)
		if !ok {
			continue
		}
		methodID, exists := objToNodeID[methodFunc]
		if !exists || methodID == sourceID {
			continue
		}
		*edges = append(*edges, Edge{
			Source:   sourceID,
			Target:   methodID,
			CallSite: CallSite{},
			Kind:     "provided",
		})
	}
}

// addMethodEdgesForInterface creates edges from sourceID to all methods on all concrete types
// that implement the given interface. This handles constructors that return interface types.
func addMethodEdgesForInterface(
	sourceID string,
	iface *types.Interface,
	concreteTypes []*types.Named,
	objToNodeID map[types.Object]string,
	edges *[]Edge,
) {
	for _, ct := range concreteTypes {
		if !types.Implements(ct, iface) && !types.Implements(types.NewPointer(ct), iface) {
			continue
		}
		addMethodEdgesForType(sourceID, ct, objToNodeID, edges)
	}
}

// resolveIfaceImpls finds all concrete method implementations for an interface method.
func resolveIfaceImpls(
	ifaceMethod *types.Func,
	iface *types.Interface,
	concreteTypes []*types.Named,
	objToNodeID map[types.Object]string,
	cache map[*types.Func][]*types.Func,
) []*types.Func {
	if impls, cached := cache[ifaceMethod]; cached {
		return impls
	}

	var impls []*types.Func
	for _, ct := range concreteTypes {
		if !types.Implements(ct, iface) && !types.Implements(types.NewPointer(ct), iface) {
			continue
		}
		method, _, _ := types.LookupFieldOrMethod(ct, true, ifaceMethod.Pkg(), ifaceMethod.Name())
		if fn, ok := method.(*types.Func); ok {
			if _, inProject := objToNodeID[fn]; inProject {
				impls = append(impls, fn)
			}
		}
	}
	cache[ifaceMethod] = impls
	return impls
}

// ===================================================================
// AST-only analysis (fallback when type-aware analysis is unavailable)
// ===================================================================

func analyzeFilesASTOnly(input Input) Output {
	fset := token.NewFileSet()
	var allNodes []Node
	var allEdges []Edge
	funcMap := make(map[string]*Node)

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

		visibility := "module"
		if ast.IsExported(name) {
			visibility = "exported"
		}

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

			var targetID string

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

// ===================================================================
// Shared helpers
// ===================================================================

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
