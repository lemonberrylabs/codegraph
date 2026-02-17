package main

// Service defines an interface with a single method.
type Service interface {
	Process(input string) string
}
