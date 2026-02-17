package main

// ServiceA is a concrete implementation of Service.
type ServiceA struct{}

func (s *ServiceA) Process(input string) string {
	return "A:" + input
}
