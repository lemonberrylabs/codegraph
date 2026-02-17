package main

import "fmt"

func main() {
	var svc Service = &ServiceA{}
	result := svc.Process("hello")
	fmt.Println(result)

	run(&ServiceB{})
}

func run(svc Service) {
	fmt.Println(svc.Process("world"))
}
