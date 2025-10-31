export class LowSync<T> {
  constructor(public adapter: any, public data: T) {}
  read() { /* no-op for tests */ }
  write() { /* no-op for tests */ }
}
