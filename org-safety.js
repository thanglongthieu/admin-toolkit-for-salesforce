export const ORG_RISK = Object.freeze({
  READ_ONLY: "read-only",
  DATA_MUTATION: "data-mutation",
  METADATA_MUTATION: "metadata-mutation",
  CODE_EXECUTION: "code-execution"
});

function normalizeHost(host = "") {
  return String(host || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
}

export function inferOrgType(host = "") {
  const normalized = normalizeHost(host);
  if (!normalized) return "Unknown org";
  if (/--(sandbox|dev|qa|uat|test|staging)\b/i.test(normalized) || /\.sandbox\./i.test(normalized)) return "Sandbox";
  if (/develop\.my\.salesforce\.com$/i.test(normalized)) return "Developer Edition";
  if (/scratch\./i.test(normalized)) return "Scratch org";
  return "Production or unknown";
}

function getOrgSafetyState(host = "") {
  const normalizedHost = normalizeHost(host);
  return {
    host: normalizedHost,
    orgType: inferOrgType(normalizedHost)
  };
}

export async function assertOrgMutationAllowed({ host = "", risk = ORG_RISK.DATA_MUTATION } = {}) {
  const state = getOrgSafetyState(host);
  if (!state.host) throw new Error("Missing Salesforce org host.");
  return { ...state, risk };
}

export async function confirmOrgMutation({ host = "", operation = "Change Salesforce", target = "", count = 0, risk = ORG_RISK.DATA_MUTATION } = {}) {
  const state = await assertOrgMutationAllowed({ host, risk });
  const countText = Number.isFinite(Number(count)) && Number(count) > 0 ? `\nItems: ${Number(count)}` : "";
  const targetText = target ? `\nTarget: ${target}` : "";
  const message = `${operation}\nOrg: ${state.host}\nOrg type: ${state.orgType}\nRisk: ${risk}${targetText}${countText}\n\nContinue?`;
  if (!window.confirm(message)) throw new Error(`${operation} cancelled.`);
  return state;
}
