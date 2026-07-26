/**
 * Independently pinned RepoDiet operator SPKI public key (RSA-2048).
 * This is public material — never a private key.
 *
 * Fingerprint (SHA-256 over exact PEM UTF-8 including trailing newline):
 *   sha256:2d063df71db431383aa19212e5ef4d744b64881b9dadf59cf10400d9c14faac4
 *
 * Corresponds to ASP / operatorAgentId 9636. Replaces a stale prior pin
 * (sha256:d495f62bd74d136390322df4a042db4250cd27c594992b55f321201a16aba662)
 * that no longer matched the production REPODIET_OPERATOR_PRIVATE_KEY —
 * confirmed via /api/okx/trust-root's privateKeyDerivedFingerprint, which
 * matched the deployed REPODIET_OPERATOR_PUBLIC_KEY exactly.
 */
export const PINNED_OPERATOR_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAwuhewkglpAMMQJFUCtqH
KmxXpv3XxUEmRI36sqY+/ozGtDpS+6sS7PYMoRuD05OmHMMuET0z42eJpj+dpAm5
LaZ9ouvrcZ04aK9SwS0EfJ4hHiFC3jaaIyU4NQ5FCTxcCQdXdBumEUiIqUdzPG16
SUecF2lLJD0WjtPeumG/9J6ypz3+K8M/f+apfGDk6JwB+0FGXtuby/l4keGC5ZB+
iq/uP4wAXgVaItvDbyFbIddtOCejKG+vqRj+adbLBEJSswGZHkDOeP/s2b9Mawj5
h7VFa7Hc74kWi1O8Ou7SbOUkXEQQBYSYdFEZBB80Xse+CIPfwNyiPV26HogdKC5I
dF/nueSnr7De8dArGmTWF1jAo0HV1LDSgN6d/L+kuSVe+H4GrRIwYS2NxUvMx86I
8On+pVmrqkXwhwNfCIasuY14Lu8er3xWek+43saBq+Wfrqg1VC0KEHuuBhgT9dko
Q1aSNfVChDiLFjqxLK54cTjn825Gv0tZFpEgHSugNUexAgMBAAE=
-----END PUBLIC KEY-----
`;

export const PINNED_OPERATOR_PUBLIC_KEY_FINGERPRINT =
  "sha256:2d063df71db431383aa19212e5ef4d744b64881b9dadf59cf10400d9c14faac4";

export const PINNED_OPERATOR_AGENT_ID = "9636";
