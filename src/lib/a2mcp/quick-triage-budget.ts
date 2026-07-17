/** Hard budgets for OKX marketplace Quick Triage — must stay under platform timeout. */
export const QUICK_TRIAGE_TIMEOUT_MS = 20_000;
export const QUICK_TRIAGE_FETCH_BUDGET_MS = 8_000;
export const QUICK_TRIAGE_ANALYSIS_BUDGET_MS = 10_000;
export const QUICK_TRIAGE_OVERALL_BUDGET_MS = 18_000;
export const QUICK_TRIAGE_MAX_FILES_INSPECTED = 800;

/** Historical incident quote — recovery allowed only via verified payment + digest. */
export const INCIDENT_QUOTE_ID = "quote_oQs2zW2cmt7o";
export const INCIDENT_PAYMENT_REFERENCE =
  "0x351daeb986fc656fd611aaf01226e297efe42cfc91be1082222b94702d5fa73f";
export const INCIDENT_REQUEST_DIGEST =
  "sha256:c8bce6d551fcf7d08a32a996b1828a13580bc7983112e38f2ec56ec5eb5bf3d6";
