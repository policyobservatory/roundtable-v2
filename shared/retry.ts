/** Retry only transient infrastructure failures, never validation/auth/SQL errors. */
export function isTransientError(error: unknown): boolean {
	const message = error instanceof Error
		? `${error.message} ${error.cause ? String(error.cause) : ''}`
		: String(error);
	return /Network connection lost|storage caused object to be reset|reset because its code was updated|D1.*(?:temporarily unavailable|overloaded)/i.test(message);
}

/** Only use for reads or writes with a stable idempotency key / deterministic result. */
export async function retryIdempotent<T>(
	operation: () => Promise<T>,
	sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try { return await operation(); }
		catch (error) {
			if (attempt >= 3 || !isTransientError(error)) throw error;
			await sleep(150 * 2 ** attempt + Math.floor(Math.random() * 100));
		}
	}
}
