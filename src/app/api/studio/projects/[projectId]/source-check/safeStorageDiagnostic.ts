const PROVIDER_CODES = new Set(["AccessDenied", "SignatureDoesNotMatch", "InvalidAccessKeyId", "RequestTimeTooSkewed", "NoSuchKey",
  "ExpiredToken", "InvalidToken", "PermanentRedirect", "AuthorizationHeaderMalformed", "SlowDown", "InternalError", "ServiceUnavailable", "RequestTimeout"]);
const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);
const ERROR_CLASSES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "S3ServiceException"]);
// This is precisely the closed wrapper grammar in h3JobStore.referenceLookupError.
const WRAPPED = /^(?:Reference metadata lookup|Reference metadata full GET after ranged signature rejection) failed \(storage HTTP ([1-5][0-9]{2})(?:, (AccessDenied|SignatureDoesNotMatch|InvalidAccessKeyId|RequestTimeTooSkewed|NoSuchKey|ExpiredToken|InvalidToken|PermanentRedirect|AuthorizationHeaderMalformed))?\)\.$/;

/** Do not invoke error accessors, stringify errors, walk causes, or retain SDK objects. */
function data(value: unknown, key: string): unknown {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && "value" in descriptor ? descriptor.value : undefined; }
  catch { return undefined; }
}

export function safeStorageDiagnostic(error: unknown): { errorClass: string; errorCode?: string; httpStatus?: number } {
  const name = data(error, "name"), code = data(error, "code");
  const knownProvider = typeof name === "string" && PROVIDER_CODES.has(name) ? name : undefined;
  const knownCode = typeof code === "string" && (PROVIDER_CODES.has(code) || NETWORK_CODES.has(code)) ? code : undefined;
  const status = data(data(error, "$metadata"), "httpStatusCode");
  const httpStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  const message = data(error, "message");
  // No arbitrary substring extraction: the entire vetted wrapper must match,
  // including its status and absence of a trailing newline or other payload.
  const wrapped = typeof message === "string" && message.length <= 240 ? WRAPPED.exec(message) : null;
  const wrappedCode = wrapped && wrapped[0] === message && Number(wrapped[1]) === httpStatus ? wrapped[2] : undefined;
  let errorClass = typeof name === "string" && ERROR_CLASSES.has(name) ? name : knownProvider ? "StorageError" : "Unknown";
  // Native Error.name is inherited. Recognize only the exact built-in prototype;
  // never traverse an arbitrary prototype chain or inspect constructor names.
  if (name === undefined) {
    try { if (error && Object.getPrototypeOf(error) === Error.prototype) errorClass = "Error"; } catch { /* Unknown stays closed. */ }
  }
  const errorCode = knownProvider ?? knownCode ?? wrappedCode;
  return { errorClass, ...(errorCode ? { errorCode } : {}), ...(httpStatus === undefined ? {} : { httpStatus }) };
}
