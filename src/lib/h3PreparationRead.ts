import { H3RecoverableReadError, isTransientH3ReadFailure } from "./h3AutomaticRecovery";

export class H3PreparationReadTimeout extends H3RecoverableReadError {
  constructor(label: string) {
    super(`H3 preparation read timed out: ${label}. No replacement video was submitted.`);
    this.name = "H3PreparationReadTimeout";
  }
}

/** Only wrap reads/validation, never provider submissions or durable writes. */
export async function boundedH3PreparationRead<T>(label: string, read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new H3PreparationReadTimeout(label)), 120_000);
    })]);
  } catch (error) {
    if (isTransientH3ReadFailure(error)) throw new H3RecoverableReadError(`H3 preparation read is temporarily unavailable: ${label}.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
