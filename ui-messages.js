// The audience is Salesforce administrators, so user-facing text keeps Salesforce's
// own vocabulary: Metadata API, Tooling API, cache. Collapsing those into "Salesforce"
// and "workspace data" cost the reader the one detail that makes an error actionable —
// which API failed — and "cached" is not a synonym for "saved".
export function formatUserFacingMessage(message = "") {
  return String(message || "");
}
