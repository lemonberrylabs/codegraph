// Advanced TypeScript patterns: chained calls, dynamic dispatch, generics

import { validate } from './utils.js';

// Chained call pattern - builder
export class QueryBuilder {
  where(condition: string): QueryBuilder {
    return this;
  }

  orderBy(field: string): QueryBuilder {
    return this;
  }

  execute(): string[] {
    return [];
  }
}

// Function returning a function (chained call target)
export function createQuery(): QueryBuilder {
  return new QueryBuilder();
}

// Uses chained calls: createQuery().where().execute()
export function runQuery(condition: string): string[] {
  return createQuery()
    .where(condition)
    .orderBy('name')
    .execute();
}

// Dynamic dispatch - obj[key]()
const handlers: Record<string, () => void> = {};

export function dispatchDynamic(action: string): void {
  handlers[action](); // dynamic call
}

// Generic function
export function identity<T>(value: T): T {
  return value;
}

// Function using generics
export function wrapValue(input: string): string {
  return identity(input);
}

// Recursive generic
export function flattenArray<T>(arr: T[][]): T[] {
  const result: T[] = [];
  for (const sub of arr) {
    result.push(...sub);
  }
  return result;
}
