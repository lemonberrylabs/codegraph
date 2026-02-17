// Logger class for testing method/constructor resolution

export class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  log(message: string): void {
    console.log(`[${this.prefix}] ${message}`);
  }

  warn(message: string): void {
    console.warn(`[${this.prefix}] ${message}`);
  }

  // This method has an unused parameter
  error(message: string, code: number): void {
    console.error(`[${this.prefix}] ${message}`);
  }
}
