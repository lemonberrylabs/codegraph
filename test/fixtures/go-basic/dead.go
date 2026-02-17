package main

func deadFunction() string {
	return "I am never called"
}

func anotherDeadFunction(param1 string, param2 int) {
	// Both params unused too
}
