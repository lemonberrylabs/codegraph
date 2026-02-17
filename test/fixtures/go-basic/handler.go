package main

func handleRequest(input string) string {
	if !validate(input) {
		return "invalid"
	}
	return processData(input)
}

func processData(data string) string {
	return data
}
