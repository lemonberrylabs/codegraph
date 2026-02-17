// Destructured parameter tests

interface Options {
  verbose: boolean;
  timeout: number;
  retries: number;
}

// Object destructured param: `timeout` is unused
export function configure({ verbose, timeout, retries }: Options): string {
  if (verbose) {
    return `retries: ${retries}`;
  }
  return 'quiet mode';
}

// Array destructured param: second element unused
export function processCoords([x, y, z]: number[]): number {
  return x + z;
}

// Nested destructured
export function handleEvent({ type, data: { id, payload } }: {
  type: string;
  data: { id: string; payload: string };
}): string {
  return `${type}:${id}`;
}

// All bindings used
export function formatUser({ name, age }: { name: string; age: number }): string {
  return `${name} (${age})`;
}

// Constructor call test
export class Service {
  constructor(private name: string) {}

  run(): string {
    return `running ${this.name}`;
  }
}

export function createService(): Service {
  const svc = new Service('test');
  return svc;
}

// Re-export consumer: imports from reexport.ts which re-exports from utils.ts
import { validate } from './reexport.js';

export function checkInput(input: string): boolean {
  return validate(input);
}
