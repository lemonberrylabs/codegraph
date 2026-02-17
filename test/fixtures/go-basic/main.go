package main

import "fmt"

func main() {
	result := handleRequest("hello")
	fmt.Println(result)
}

// formatOutput has an unused parameter
func formatOutput(data string, unusedParam int) string {
	return "[output] " + data
}
