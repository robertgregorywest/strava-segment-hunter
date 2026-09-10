/** Timestamped console logging so a redirected/tailed log file is actually readable. */

function timestamp(): string {
  return new Date().toISOString();
}

export function log(message: string): void {
  console.log(`[${timestamp()}] ${message}`);
}

export function logError(message: string): void {
  console.error(`[${timestamp()}] ${message}`);
}

/** Renders an unknown error, including its `cause` chain, in one line for log output. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMessage = cause instanceof Error ? `: ${cause.message}` : '';
    return `${err.name}: ${err.message}${causeMessage}`;
  }
  return String(err);
}
