package main

func validate(input string) bool {
	return len(input) > 0
}

func sanitize(input string, encoding string) string {
	// encoding is unused
	return input
}
