package main

// ServiceB is another concrete implementation of Service.
type ServiceB struct{}

func (s *ServiceB) Process(input string) string {
	return "B:" + format(input)
}

func format(s string) string {
	return "[" + s + "]"
}
