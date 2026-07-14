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
    toBeLessThanOrEqual(expected: number): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toContain(expected: unknown): void;
    toContainEqual(expected: unknown): void;
    toMatch(expected: RegExp | string): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledTimes(expected: number): void;
    toBeNull(): void;
    toBeInstanceOf(expected: unknown): void;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect<T = unknown>(actual: T): Matcher;

  export interface Mock<TArgs extends unknown[], TReturn> {
    (...args: TArgs): TReturn;
    mock: {
      calls: TArgs[];
    };
    mockClear(): void;
  }

  export function mock<TArgs extends unknown[], TReturn>(implementation: (...args: TArgs) => TReturn): Mock<TArgs, TReturn>;

  export namespace mock {
    function module(specifier: string, factory: () => Record<string, unknown>): void;
  }
}
