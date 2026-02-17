// Dead code - these functions are never called

export function deadFunction(): string {
  return 'I am never called';
}

export function anotherDeadFunction(param1: string, param2: number): void {
  // Both params unused too
}

// Mutual recursion — both should be dead since unreachable from entry
export function mutualA(): void {
  mutualB();
}

export function mutualB(): void {
  mutualA();
}
