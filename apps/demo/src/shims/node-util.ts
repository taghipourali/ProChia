export function promisify<T>(fn: (...args: any[]) => void) {
  return (...args: unknown[]) =>
    new Promise<T>((resolve, reject) =>
      fn(...args, (err: Error | null, value: T) => (err ? reject(err) : resolve(value))),
    );
}
