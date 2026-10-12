/** Polls `probe` until it returns a truthy value or the timeout elapses. */
export async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false>,
  { timeoutMs = 45_000, intervalMs = 500 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
