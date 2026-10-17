import { setTimeout as sleep } from 'node:timers/promises';

// First-retry delay before any subsequent attempt.
export const RETRY_DELAY_MS = 300;

export async function withFirstRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    await sleep(RETRY_DELAY_MS);
    return fn();
  }
}
