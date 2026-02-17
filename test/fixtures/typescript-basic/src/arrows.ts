// Arrow functions and closures

export const greet = (name: string): string => {
  return `Hello, ${name}!`;
};

export const processItems = (items: string[]): string[] => {
  return items.map(transformItem);
};

const transformItem = (item: string): string => {
  return item.toUpperCase();
};

// Unused arrow function
export const unusedArrow = (x: number, y: number): number => {
  return x + y;
};

// Higher-order function
export const createMultiplier = (factor: number) => {
  return (value: number) => value * factor;
};
