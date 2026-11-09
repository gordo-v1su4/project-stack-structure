const PROVIDER_CODES = new Set(["AccessDenied", "SignatureDoesNotMatch", "InvalidAccessKeyId", "RequestTimeTooSkewed", "NoSuchKey",
  "ExpiredToken", "InvalidToken", "PermanentRedirect", "AuthorizationHeaderMalformed", "SlowDown", "InternalError", "ServiceUnavailable", "RequestTimeout"]);
const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);
const ERROR_CLASSES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "S3ServiceException"]);
// Exact, application-owned messages only. These labels identify a failed gate;
// they never include an asset, object key, expected value or response payload.
const VALIDATION_CODES = new Map([
  ["The source-reference inventory exceeds its supported bound.", "REFERENCE_INVENTORY_BOUND"],
  ["The source-reference inventory requires durable owned images.", "REFERENCE_OWNERSHIP"],
  ["The canonical raw-reference manifest differs.", "REFERENCE_MANIFEST"],
  ["The canonical raw-reference binding differs.", "REFERENCE_BINDING"],
  ["The conditional source-reference response differs or exceeds its bound.", "REFERENCE_RESPONSE"],
  ["The canonical source-reference pixels changed.", "REFERENCE_PIXELS"],
  ["The immutable reference version is unavailable.", "REFERENCE_VERSION_UNAVAILABLE"],
  ["The immutable reference response version changed.", "REFERENCE_RESPONSE_VERSION"],
  ["The reference exceeds the supported image size.", "REFERENCE_SIZE"],
  ["The immutable reference response was incomplete or exceeded its bound.", "REFERENCE_BODY_BOUND"],
  ["Durable generation storage is not configured.", "GENERATION_STORAGE_CONFIGURATION"],
  ["Reference metadata lookup could not reach durable storage.", "REFERENCE_TRANSPORT_UNAVAILABLE"],
]);
// This is precisely the closed wrapper grammar in h3JobStore.referenceLookupError.
const WRAPPED = /^(?:Reference metadata lookup|Reference metadata full GET after ranged signature rejection) failed \(storage HTTP ([1-5][0-9]{2})(?:, (AccessDenied|SignatureDoesNotMatch|InvalidAccessKeyId|RequestTimeTooSkewed|NoSuchKey|ExpiredToken|InvalidToken|PermanentRedirect|AuthorizationHeaderMalformed))?\)\.$/;

/** Do not invoke error accessors, stringify errors, walk causes, or retain SDK objects. */
function data(value: unknown, key: string): unknown {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && "value" in descriptor ? descriptor.value : undefined; }
  catch { return undefined; }
}

export function safeStorageDiagnostic(error: unknown): { errorClass: string; errorCode?: string; httpStatus?: number; validationCode?: string } {
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
  const validationCode = typeof message === "string" ? VALIDATION_CODES.get(message) : undefined;
  return { errorClass, ...(errorCode ? { errorCode } : {}), ...(httpStatus === undefined ? {} : { httpStatus }), ...(validationCode ? { validationCode } : {}) };
}
