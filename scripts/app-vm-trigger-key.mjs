/** Production key-class admission only. The Trigger server still authenticates
 * the credential and its project; a prefix cannot prove either property.
 * Accept legacy production keys and the SDK 4.5.16 additional-key format.
 * Keep the failure fixed: never include supplied values or fragments in logs.
 */
export function assertProductionTriggerKey(value) {
  if (typeof value !== "string" || !/^tr_prod_(?:[A-Za-z0-9]+|sk_[A-Za-z0-9]{24})$/.test(value)) {
    throw new Error("Production deployment requires a production-class TRIGGER_SECRET_KEY from STACK_STRUCTURE_TRIGGER_PROD_SECRET_KEY.");
  }
}
