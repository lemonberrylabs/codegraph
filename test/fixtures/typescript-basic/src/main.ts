// Entry point - calls handleRequest
import { handleRequest } from './handler.js';
import { deadFunction, anotherDeadFunction } from './dead.js';

export function main() {
  const result = handleRequest('hello');
  console.log(result);
}

// This function has an unused parameter
export function formatOutput(data: string, _options: object, unusedParam: number): string {
  return `[output] ${data}`;
}

main();
