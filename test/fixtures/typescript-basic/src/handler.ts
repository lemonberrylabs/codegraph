// Handler module - called by main
import { validate } from './utils.js';
import { Logger } from './logger.js';

export function handleRequest(input: string): string {
  const logger = new Logger('handler');
  logger.log('handling request');

  if (!validate(input)) {
    return 'invalid';
  }

  return processData(input);
}

function processData(data: string): string {
  return data.toUpperCase();
}
