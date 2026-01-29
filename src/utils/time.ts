function measureTime<T>(label: string, fn: () => T): { value: T; ms: number } {
  const start = process.hrtime();
  const result = fn();
  const [seconds, nanoseconds] = process.hrtime(start);
  const ms = seconds * 1000 + nanoseconds / 1000000;
  return { value: result, ms };
}

export default measureTime;
