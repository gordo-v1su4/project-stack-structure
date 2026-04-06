declare module "bun:test" {
  export interface Matcher {
    not: Matcher;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toMatchObject(expected: Record<string, unknown>): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toContain(expected: unknown): void;
    toContainEqual(expected: unknown): void;
    toBeNull(): void;
    toBeInstanceOf(expected: unknown): void;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect<T = unknown>(actual: T): Matcher;
}
