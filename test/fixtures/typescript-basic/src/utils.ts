// Utility functions

export function validate(input: string): boolean {
  return input.length > 0;
}

export function sanitize(input: string, encoding: string): string {
  // encoding is unused
  return input.trim();
}

// Recursive function
export function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
