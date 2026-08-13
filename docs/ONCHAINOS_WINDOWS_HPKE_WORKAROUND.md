# onchainos on Windows — HPKE "Failed to open ciphertext" workaround

Verified 2026-08-13 against `onchainos` 4.4.10 / `okx-a2a` 0.2.5 on Windows 11.

## Symptom

Every **signed** operation fails, while reads succeed:

```
{"ok":false,"error":"HPKE decryption failed: Failed to open ciphertext"}
```

| Works | Fails |
|---|---|
| `agent get-agents`, `agent service-list`, `agent device-list` | `agent update` |
| `agent upload` | `agent create-task` |
| `payment quote` (documented "Never signs") | `payment pay` |
| `wallet status`, `wallet balance` | `wallet sign-message` |

Login always prints `Warning: OS keyring write failed (failed to write keyring blob), using file fallback`.

### Second symptom — misleading "no user agent found"

The same stale credential does not always surface as an HPKE error. Observed 2026-08-13:
`agent prepare-create` run **without** the wrapper returned

```json
"identity":{"ok":false,"hint":"no user agent found; route to `okx-ai` with the intent \"Register a user identity\""}
```

even though User Agent #10466 exists and is active. Re-running the identical command **through the
wrapper** returned `identity:{agentId:"10466", ok:true}` and a full routing block.

Following that hint would have registered a **duplicate** User identity to fix a problem that was
only a stale local credential. Treat any sudden "identity not found" from a known-good account as a
suspected credential shadow first — re-run through the wrapper before creating anything.

## Root cause

The CLI stores the ephemeral **HPKE session private key** in Windows Credential Manager under target
`agentic-wallet.onchainos`, with `<ONCHAINOS_HOME>/keyring.enc` as a file fallback.

On this machine the OS keyring **write** fails, so the current key lands in `keyring.enc` — but the
**read** still finds the older Credential Manager entry and returns a **stale** key. That stale key
cannot decrypt `encryptedSessionSk` in `session.json`, which the server encrypted to the *current*
public key. Hence "Failed to open ciphertext".

This is why the failure was account-independent (the credential is machine-wide) and survived every
re-login (the write kept failing, so the stale entry was never replaced).

## Evidence

- Deleting the credential immediately restored TEE signing (`wallet sign-message` returned a real signature).
- A real A2MCP payment then succeeded: tx `0xbcd19ee37b87ed4dc119a1e7ca7372b6a0f7a05efbfa0199785bd8b20159df3a`,
  balance moved `1,446,678 → 1,416,678` raw (exactly 0.03 USDT).
- Agent #9636's avatar update then succeeded: tx `0x0984d717a1a381b30b7828041d612b8777e642807104623b552bf024a4235eba`.
- The credential is **recreated** by any keyring-touching call — login, `agent upload`, and the
  `okx-a2a doctor` A2A preflight that `agent update` runs first. So the delete must happen in the
  *same* invocation as the signed command.

## Workaround

Use the wrappers at `C:\Users\hp\okx-buyer.ps1` and `C:\Users\hp\okx-seller.ps1`. Each one:

1. pins its own `ONCHAINOS_HOME` (buyer and seller must never share a state root),
2. sets `ONCHAINOS_SKIP_A2A_PREFLIGHT=1` so the preflight cannot recreate the credential,
3. runs `cmdkey /delete:agentic-wallet.onchainos` (absent credential is a harmless no-op),
4. forwards all arguments to `onchainos` and propagates its exit code.

```powershell
.\okx-seller.ps1 agent get-agents --agent-ids 9636
.\okx-buyer.ps1  payment quote <url> --method POST --param k=v
```

Apply it for signed operations. Ordinary reads do not need it.

## Corrections worth keeping

- `ONCHAINOS_FORCE_FILE_KEYRING` appears in OKX's Python/macOS sample but **does not exist** in the
  Rust CLI — setting it changes nothing.
- Real env vars in the 4.4.10 binary: `ONCHAINOS_HOME`, `ONCHAINOS_SKIP_A2A_PREFLIGHT`,
  `ONCHAINOS_KEEP_SESSION`, `ONCHAINOS_NO_SELF_UPDATE`, `ONCHAINOS_WS_URL`, `ONCHAINOS_PRETTY`,
  `ONCHAINOS_PENDING_DECISIONS_TTL_DAYS`, `ONCHAINOS_NO_BROWSER`.
- No env var or flag selects the keyring backend, which is why a wrapper is required.

## Safety

Wallet keys live server-side in the TEE and never touch this machine, so the deleted credential holds
only an ephemeral session key — removal is safe and reversible by re-login. Backups of the original
credential blob, `keyring.enc`, and `session.json` were taken before the first deletion.
