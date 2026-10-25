# Security & reliability audit — `tab-to-components`

**Audit date:** 2026-10-25 · **Repository:** `D:\Github\tab-to-components` · **HEAD:** `4df767d` ("Fix ci path issues") · **Package:** `tab-to-components@0.4.0` (npm latest)
**Environment:** Windows 10.0.26200 AMD64 · Node v24.21.0 · pnpm 11.28.5 · Vite 8.3.5 (workspace)
**Status of the codebase:** builds, type-checks and passes its suites as-is (see [§2](#2-baseline-the-codebase-runs-today)). Every finding below is **latent** — none is masked by a failing test.

**Method:** four parallel specialist audits (server/runtime, browser client, transform/parser, dependencies/CI/release) → independent reproduction of every critical/high/medium claim → adversarial severity/false-positive review. All work was read-only for tracked files; evidence lives in `.tmp/security-audit/` (git-ignored). 53 findings were produced, 58 entries counting duplicates; after deduplication and review calibration the report contains **54 distinct items: 1 high, 8 medium, 32 low, 13 info** (3 of the info items were found by the reviewer).

---

## 1. Executive summary

**Verdict: no critical issue; one high-severity latent RCE on Windows; the library is safe for its intended local dev use, but the editor endpoint and the Windows process launch need hardening before wider adoption.**

The plugin is a dev-only tool. Its risk profile is dominated by one design decision: the dev server exposes an **unauthenticated HTTP endpoint that launches a process on the developer's machine** using a file path supplied by the browser. On Windows the editor command line is assembled with a home-grown quoter and executed through `cmd.exe`, which turns certain project/dependency filenames into shell syntax. That is the only confirmed code-execution primitive (`SRV-1`), and it is remotely triggerable through the unauthenticated endpoint (`SRV-2`), including from a carrier shipped inside an npm dependency without any install script.

There is **no XSS, no prototype pollution and no production leakage** in the browser runtime, and the custom endpoint's lexical containment survives every traversal/UNC/absolute-path bypass attempted. The published artifact has a **release-provenance weakness** (dirty-tree publish, wrong `gitHead`, no tags/provenance) but no evidence of tampering.

**Top five, in recommended fix order:**

| # | ID | Sev | Finding |
| --- | --- | --- | --- |
| 1 | `SRV-1` | **High** | Windows `cmd.exe` argument injection in the editor launcher (`shell: true` + home-grown quoting at `src/editor.ts:207-233`) → arbitrary command execution with a crafted in-root path component. Remotely triggerable via `SRV-2`. |
| 2 | `SRV-2` | Medium | Unauthenticated, cross-origin, state-changing editor endpoint (`GET`+`POST`, no Origin/Sec-Fetch-Site check, no token, no rate limit). Drive-by editor open, spawn storm, root disclosure; trigger for `SRV-1`. |
| 3 | `CLI-1` + `SRV-5` | Medium | Page-authored `data-ttc` attributes are trusted as build-generated source coordinates. Default mode opens in-root files only; with `editor: "auto"` the same gesture reaches Vite's endpoint, which has **no** root containment. |
| 4 | `DEP-3` | Medium | Published 0.3.0/0.4.0 are not tied to any commit: `0.4.0` `gitHead` points at a `0.3.0` tree, publish preceded the version-bump commit by 45 s, no tags, no provenance. Not tampering — release-process weakness. |
| 5 | `TRF-1` | Medium | Compiled-JSX fallback rewrites **any** 5-argument call with a source-like 5th object — unrelated analytics calls silently receive `data-ttc` props, `null` props are replaced with an object, and legitimate code can throw. |

**Separate consumer sidebar — `DEP-1` (external advisory, package severity medium):** the documented `editor: "auto"` path plus the peer range `vite ^6 || ^7 || ^8` admit Vite versions affected by **GHSA-587h-7wmj-h5pm / CVE-2026-112942** (HIGH: launch-editor `fs.existsSync` bypass + `%` escaping → command injection on Windows; fixed in Vite 6.4.4 / 7.3.7 / 8.1.6 / 8.2.4 / 8.3.3) and by **GHSA-v6wh-96g9-6wx3 / CVE-2026-53632** (MEDIUM: NTLMv2 hash disclosure via UNC paths; fixed in 6.4.3 / 7.3.5 / 8.0.16). This is a Vite/launch-editor issue, not a defect in this plugin's own code: Vite registers `/__open-in-editor` on every dev server whether or not the plugin is installed, the default `editor: "code"` path uses the plugin's own endpoint, and the repo's installed Vite copies (8.3.5 / 7.3.7 / 6.4.5) are patched. The actionable part is documentation/guard-rail for `auto` consumers.

### Severity rubric used

| Severity | Definition |
| --- | --- |
| **critical** | Code execution or secret theft with default config and no local-content precondition. |
| **high** | Code execution / meaningful confidentiality-integrity impact with a realistic precondition (platform + content + remote trigger or one deliberate gesture), confirmed against the code. |
| **medium** | Attacker-influenced trusted action or dev-machine impact requiring a deliberate developer gesture or opt-in configuration; supply-chain/provenance weakness with no demonstrated compromise; defense-in-depth gap with a concrete chain. |
| **low** | Configuration footgun, malformed-input crash, UX/DX defect, or hardening gap needing local control/unlikely preconditions. |
| **info** | Hardening observation, documentation mismatch, test-coverage gap, or investigated-and-refuted candidate worth recording. |

---

## 2. Baseline: the codebase runs today

The audit first established the factual baseline at HEAD `4df767d`, with `dist/` rebuilt from current `src/`:

| Command | Result |
| --- | --- |
| `pnpm build` | exit 0 — `client.js` 21,872 B / 7,186 B gzip |
| `pnpm typecheck` | exit 0 — 0 diagnostics |
| unit suite | **378 passed / 1 skipped**, 0 failed (19/19 files) |
| integration suite | **29 passed**, 0 failed (real Vite 8 dev servers, SSR, production builds) |
| `test:matrix` | 8 passed / 10 skipped — Vite 7 tier self-skips in this sandbox (esbuild needs piped child processes) |
| `verify:package` | **60/60 checks** — 21 files / 116.3 KiB, clean-consumer install, packed plugin boots a dev server, dev runtime cannot leak into production builds |

Two environment caveats apply to reproduction in this sandbox (not product defects): Vite's Windows `net use` probe needs the repo's `scripts/sandbox-shim.mjs` preloaded into vitest, and the Vite 7 matrix tier is not exercised. Details in `.tmp/security-audit/baseline.md`.

**Consequence:** every finding is a gap outside the current assertions. The suite is green, so any claimed bug needed its own reproduction — which is what §4–§6 record.

---

## 3. Threat model (read this before judging severity)

| Attacker / trust boundary | What they can do | Relevant findings |
| --- | --- | --- |
| **Remote web page** in the developer's browser | Call the dev server on localhost/LAN by URL; no response reading required for side effects | `SRV-1`, `SRV-2` |
| **LAN / tunnel / `server.host: true` client** | Same, without browser restrictions (Host = IP is always allowed by Vite) | `SRV-1`, `SRV-2` |
| **Script already running in the dev page** | Same privilege as the page; can read `window.__TTC_CONFIG__` and call the endpoint | `CLI-1`, `CLI-6`, `CLI-7`, `CLI-12` (defense-in-depth only) |
| **Repository / dependency content** | Already executes on a dev server via `vite.config.ts` and dependency code; a dependency can also **ship a file** without executing | `SRV-1` (carrier), `SRV-3` (footgun), `DEP-4` |
| **`vite build` / production output** | Nothing — dev-only guards hold | Refuted: no markers/overlay/endpoint in builds |
| **`vite preview`, Vitest** | Preview registers no endpoint/client module (probed); Vitest resolves the plugin as a dev server, so markers appear in test renders | `SKP-2`, `TRF-10` |

The property "the endpoint only accepts files inside the project root" is a **lexical** guarantee, not a sandbox: a pre-existing junction/symlink can point outside (`SRV-6`), and `editor: "auto"` bypasses the plugin's endpoint entirely (`SRV-5`).

---

## 4. Findings — security

### 4.1 `SRV-1` — HIGH — Windows `cmd.exe` argument injection in the editor launcher

**Location:** `packages/tab-to-components/src/editor.ts:207-211`, `:213-233` (`spawn(commandLine, { shell: true })` at `:223-224`), reachable from `src/plugin.ts:359-386` and from every Alt+click.
**CWE-78 / CWE-88 · Windows only · confidence: confirmed by execution (three independent harnesses).**

**What happens.** On win32 the launcher joins the editor command and its arguments into one string and runs it through the shell:

```ts
// src/editor.ts
function quoteWindowsArgument(argument: string): string {           // :207-211
  if (argument !== "" && !/[\s"]/.test(argument)) return argument;  // no metachar escaping
  return `"${argument.replace(/"/g, '\\"')}"`;                      // not cmd.exe quoting
}
...
const commandLine = [file, ...args].map(quoteWindowsArgument).join(" "); // :222
const child = spawn(commandLine, { shell: true, ... });                  // :223-224
```

`& | < > ^ ( ) % ! ;` are never escaped, so a target path component containing `&` is interpreted by `cmd.exe` as a command separator. The docstring ("Single-quote/escape a token for a `cmd.exe /c` command line") is simply wrong.

**Precondition chain (state it precisely):**
1. Windows dev-server machine.
2. An **existing** path component inside the Vite root whose name contains `&` and no whitespace — a repository file, a generated file, or **a file shipped inside an npm dependency** (`node_modules/<pkg>/&calc&/payload.tsx`). No install script is required, so pnpm 11's build-script default-deny does not help.
3. The text after `&` resolves to a command. `cmd.exe` searches the **current working directory first**, then `PATH`; a payload `.cmd` in the project root works without any `PATH` change.
4. Trigger: any origin calls `GET/POST /__ttc/open-in-editor?file=<carrier>:1:1` (see `SRV-2`), or the developer Alt+clicks an element whose marker resolves to the carrier.

**Evidence (trimmed; full logs in `.tmp/security-audit/poc-server/` and `.tmp/security-audit/logs/t6-*.log`):**

```text
# t2, real Vite 8 server, default `code` preset, fake code.cmd on PATH
=== 1. carrier path via HTTP ===   status: 200 | injected command marker: true
    fake `code` argv log: -r -g D:/.../poc-server/root/src/x
=== 2. plain file (control)   ===  status: 200 | injected command marker: false

# t7, dependency-shipped carrier + cross-origin trigger (recording launcher)
dependency carrier:                    status=200 launches=1
dependency carrier cross-origin:       status=200 launches=2   (Origin evil + Sec-Fetch-Site cross-site)
recorded target: .../node_modules/evil/&calc&/payload.tsx
missing/outside/traversal:             400
```

The client audit's `AT&T.tsx` example is **not** exploitation: `code -r -g D:/proj/AT&T.tsx:1:1` runs `T.tsx:1:1` as a second command, which normally is not executable — the visible effect is a truncated editor launch. RCE requires the tail to name a real command; a path containing a space is accidentally quoted and does not split.

**Impact.** Arbitrary command execution with the developer's privileges on Windows when a crafted path component (and optionally a payload) is present; otherwise silent corruption of legitimate launches for paths containing `&` (e.g. a checkout under `R&D`). Combined with `SRV-2` the trigger is remote; the carrier can arrive through a dependency.

**Fix (both layers needed).**
1. Stop concatenating a command line: resolve the executable to an absolute path and call `spawn(exe, args, { shell: false })`. Windows `.cmd`/`.bat` shims do need a shell — use launch-editor's proven builder: reject `CR/LF`, reject `%`, escape `[&|<>,;=^]` with `^`, then double-quote when needed (Vite 8.3.5 ships exactly this in `node_modules/vite/dist/node/chunks/node.js:14341-14350`).
2. Reject win32 metacharacters/`%`/CR-LF and UNC roots in the **resolved target path** before launching, and log a clear error (non-200).
3. Set a neutral `cwd` (home/temp) for the spawn so relative payload resolution cannot use the project root; verify the resolved executable is not inside the project root.
4. Add unit tests for the command-line builder (not just a mocked `spawn` spy) plus an end-to-end test with a carrier filename; the existing integration test uses a space-free path and never reaches the metacharacter branch.

### 4.2 `SRV-2` — MEDIUM — unauthenticated, cross-origin editor endpoint

**Location:** `src/plugin.ts:341-387` (middleware), method check `:353`, root leak via `src/virtual.ts:46-52` / `src/plugin.ts:186-198`.
**CWE-352 / missing authorization · confidence: confirmed by execution.**

The middleware is a state-changing, process-spawning endpoint with no authentication and no origin validation. It accepts `GET` (so `<img>`, `<link>`, top-level form navigation and `fetch(..., {mode:"no-cors"})` can fire it) and `POST`. Any file that exists inside the project root can be opened at an attacker-chosen line/column, including `.env`, `.git/config` and `node_modules/**`.

**Evidence:**

```text
normal GET, Host=127.0.0.1                          status=200 launches+1
GET, Origin=https://evil.example                     status=200 launches+1   ← no Origin check
GET, Sec-Fetch-Site: cross-site                      status=200 launches+1
POST simple request, Origin=https://evil.example     status=200 launches+1
GET, Host=192.168.0.10:port (LAN ip)                 status=200 launches+1   ← IP hosts always allowed
GET, Host=evil.example (plain-HTTP DNS rebinding)    status=403 launches+0   ← Vite host check
allowedHosts: true + Host=evil.example               status=200 launches+1
25 concurrent unauthenticated GETs                   ~25 editor launches, no throttle/dedupe
virtual client module                                 leaks absolute project root
```

Vite's default CORS prevents a public origin from **reading** the response, but not from causing the side effect; a localhost origin can read it, and `server.cors: true` turns it into an oracle. Vite's host validation protects only plain-HTTP default configs: it is skipped for `server.https` and defeated by `allowedHosts`. The plugin's `configureServer` middleware runs **before** Vite's proxy/base middlewares, so a proxy rule cannot shield the endpoint either. Any `host: true`, tunnel or reverse proxy exposure exposes it to the network.

**Impact.** Any web page (or LAN device, or tunnel user) can (a) make the editor open any existing in-root file, repeatedly; (b) spawn unbounded editor processes (folded `SRV-4`); (c) trigger `SRV-1` if a carrier exists; (d) feed arbitrary `file`/`line`/`column` to a user-supplied `editor` launcher; (e) read the absolute project root from the virtual module. No file **content** is returned by this endpoint.

**Fix.** Require a same-origin browser request: reject `Sec-Fetch-Site: cross-site/same-site`; when `Origin` is present, allow only the resolved dev-server origins (`localhost`, `127.0.0.1`, `[::1]`, plus `server.origin` for tunnels). Prefer `POST` for the action; add a per-server random token in `ClientConfig` and require it (header or query). Add a launch rate limiter/dedupe (`Map<file, lastMs>`, e.g. 250–500 ms and a per-window cap → 429). Use `fs.promises.stat` with a short timeout instead of `statSync`. Consider refusing to register the endpoint when the resolved host is non-loopback unless explicitly opted in, and document that exposing the dev server exposes this endpoint.

### 4.3 `CLI-1` + `SRV-5` — MEDIUM — page-authored `data-ttc` markers are trusted as source coordinates

**Location:** `src/client/marker.ts` (parse), `src/client/chain.ts` / `src/client/install.ts:179-209` (entry selection), `src/client/editor.ts:44-71` (URL construction); `SRV-5`: `src/plugin.ts:170-178`, `:334`; Vite `node_modules/vite/dist/node/chunks/node.js:14470-14488`.
**Confused deputy · confidence: confirmed by execution (happy-dom + real Vite server).**

The overlay treats `data-ttc` / `data-ttc-name` attributes exactly like build-generated markers. When they are authored by app markup — including sanitized or user-generated HTML rendered in dev — a hostile element can spoof the hover label and make the action picker open an attacker-chosen path. Executed: DOM-only `<button data-ttc="package.json:1:1">` produces a valid entry; Alt+click on `<button data-ttc="../../../Windows/win.ini:1:1">` fires `/__ttc/open-in-editor?file=D:/proj/../../../Windows/win.ini:1:1` with `defaultPrevented=true`.

The **default** configuration bounds the impact: `parseEditorTarget` rejects outside/traversal/absolute/UNC inputs (verified across nine bypass classes), so only **existing files under the project root** can be opened. With `editor: "auto"` the client points at Vite's `/__open-in-editor`, which resolves with `path.resolve(srcRoot, file)` and only `fs.existsSync` — no containment — so **any existing file on the machine** can be opened. The plugin's README containment claim is true only for its own endpoint.

**Impact.** Requires rendered hostile markup + a deliberate modifier-click; no script execution, no file contents returned. Spoofed source labels can also mislead a developer about where a component comes from.

**Fix.** Validate markers in the client before acting: reject absolute paths, `..` segments, backslashes-as-separators and control characters; clamp line/column. In auto mode, register a validating middleware for `/__open-in-editor` **before** Vite's internal handler (Vite registers it after `configureServer` hooks) or proxy the request through the plugin; otherwise correct the README to say containment applies only to the plugin endpoint. Treat `data-ttc` authored in application markup as untrusted.

### 4.4 `TRF-1` — MEDIUM — compiled-JSX fallback rewrites unrelated calls

**Location:** `src/transform.ts:369-417` (`injectCompiledJsxMarkers`); idempotency guard `:187`.
**Confidence: confirmed by execution (transform, real Vite dev serving, src Vitest).**

When another `pre` plugin compiles JSX first, the fallback walks **every** `CallExpression` with ≥5 arguments whose 5th argument is an object literal containing `fileName` plus numeric `lineNumber`/`columnNumber` — without checking the callee. It then injects `"data-ttc"` (and `"data-ttc-name"`) into the 2nd argument, and replaces a `NullLiteral` 2nd argument with an object.

```text
trackEvent("checkout", null, user, amount, {fileName, lineNumber, columnNumber})
  → trackEvent("checkout", { "data-ttc": "src/App.tsx:10:3" }, user, amount, …)
analytics({ … }, payload, a, b, {fileName, lineNumber, columnNumber})
  → marker property injected into the analytics props object
```

**Impact.** Silent data corruption in compiled-first setups (`@vitejs/plugin-react-swc`, Babel JSX user plugins, React Compiler, and `React.createElement` output when a bail-out regex triggers). The rewritten call can throw where the original ran (`TypeError: checkout: props must be null`). Dev-only, shape-specific, but user-visible and avoidable.

**Fix.** Verify the callee is `jsxDEV`/`jsx`/`jsxs`/`createElement` (including the Babel `_jsxDEV` alias) and that the call has the dev-transform shape before rewriting; only replace `null` props for a confirmed `jsxDEV`/`jsx` call; stop walking once the marker is applied. Add decoy tests for analytics-style calls and `null` props.

---

## 5. Findings — medium (remaining)

| ID | Finding | Location | Impact / fix |
| --- | --- | --- | --- |
| `DEP-1` | Documented `editor:"auto"` + peer `vite ^6\|\|^7\|\|^8` admit Vite versions with a HIGH launch-editor advisory (GHSA-587h-7wmj-h5pm; NTLM advisory GHSA-v6wh-96g9-6wx3). | `packages/tab-to-components/package.json:79`; README `auto` mentions; `src/plugin.ts:170-173` | Not a defect in this package's own code and the repo's installed Vite is patched. Fix: state patched floors in README/`peerDependencies` docs (`>=6.4.4 / 7.3.7 / 8.3.3`; NTLM `>=6.4.3 / 7.3.5 / 8.0.16`), consider a dev-time version warning. |
| `DEP-2` | CI workflow: mutable action major tags, no `permissions`, persisted checkout credentials, no timeout. | `.github/workflows/ci.yml:20,25,29,47` | PR code runs `pnpm gate` with default token scope. Fix: pin actions to commit SHAs, add `permissions: contents: read`, `persist-credentials: false`, `timeout-minutes`. |
| `DEP-3` | Published 0.3.0/0.4.0 not provably tied to a commit: 0.4.0 `gitHead` = `533a634` whose tree says `0.3.0`; publish 17:05:25+08 preceded the bump commit 17:06:10+08 by 45 s; no tags; no provenance/attestations. | `packages/tab-to-components/package.json:76` (`prepublishOnly` only); `.gitignore:25` (release runbook not tracked) | Release-integrity risk, **no tampering evidence**; published file set matches the allowlist shape. Fix: clean-tree + tag assertion in the publish script, tagged CI publish with `--provenance`, tag releases, treat 0.4.0 as untraceable, publish 0.4.1 with provenance. |
| `DEP-4` | Tracked Remix v2 fixture pins `vite@5.4.21`, `tar@6.2.1` (GHSA-34x7-hfp2-rc4v, HIGH), `esbuild@0.17.6/0.21.5`; the gate **does** build the Remix cell (`scripts/compat-matrix.mjs:152-174`), so they execute, but the vulnerable features are not attacker-reachable. | `compat/remix2-react18/pnpm-lock.yaml`; `compat/remix2-react18/package.json` | Dependency-policy finding. Fix: upgrade the fixture (or drop it), add an OSV/audit scanner to the gate, keep the lockfiles patched. |

---

## 6. Findings — low and info

Severity after review calibration; full evidence for each item is in the per-area reports under `.tmp/security-audit/`.

### 6.1 Low (32)

**Server / runtime**
| ID | Finding | Location |
| --- | --- | --- |
| `SRV-3` | Editor executable resolved by `cmd.exe` from the dev-server cwd → a repo/dependency `code.cmd` shadows the real editor on click (same fix as `SRV-1`; running a dev server already executes repo config, so this is a footgun/defense-in-depth gap). | `src/editor.ts:219-233` |
| `SRV-6` | Containment is lexical only: a pre-existing junction/symlink inside the root passes `relativeToRoot` + `statSync`, so the editor and the 200/400 oracle reach outside-root files (`realpathSync.native` resolves it; `realpathSync` does not; `lstat` reports a junction as a directory). | `src/paths.ts:170-209`, `src/editor.ts:288-335` |
| `SRV-7` | `editorEndpoint` unvalidated: `""`/`"/"` hijacks the dev index and turns `/` into an editor action; the base prefix is stripped but never required (endpoint reachable with and without `base`); client normalizes empty to Vite's endpoint while the server keeps it. | `src/plugin.ts:174-177,338-351`, `src/client/config.ts:153-158` |
| `SRV-8` | Win32 launch failures are silent (HTTP 200, no terminal warning; the 5xx branch is dead code) — README contradicts this; also covers client-side `CLI-8` (opaque response treated as success, no timeout, malformed marker rejects). | `src/editor.ts:228-243,255-279`, `src/client/editor.ts:87-135` |
| `SRV-9` | Non-`RegExp` `include`/`exclude` values crash `transform` (`pattern.test is not a function`). | `src/paths.ts:278-283` |
| `SRV-10` | 200-vs-400 file-existence oracle: readable by localhost origins by default; any origin can read it with `server.cors: true`. | `src/plugin.ts:359-386` |

**Browser client**
| ID | Finding |
| --- | --- |
| `CLI-2` | Marker text copied/displayed verbatim: newline/control/bidi characters inject into the clipboard and spoof displayed paths. |
| `CLI-3` | `suppressNextClick` survives a mousedown without a click and swallows a later app click (Escape/blur do not clear it). |
| `CLI-4` | Menu focus stolen and not restored; Tab focus and highlighted row diverge (Enter on "Copy file name" can run "Open in IDE"); app Enter/Space swallowed. |
| `CLI-5` | Legacy clipboard fallback mutates the app DOM/selection without restoring focus. |
| `CLI-6` | Config fields reach URL construction without origin/path validation; `//host/` base, notionally invalid endpoint characters and getter traps have surprising behavior. |
| `CLI-7` | Absolute project root + version remain readable on `window.__TTC_CONFIG__`/`__TTC_VERSION__` after boot/uninstall. |
| `CLI-9` | Fiber discovery depends on expando enumeration order (legacy key can win) and throwing property descriptors escape into hover/click handlers. |
| `CLI-10` | Overlay host appended once and forgotten: body replacement silently loses the overlay while `__TTC_READY__` stays true; strict CSP leaves the shadow `<style>` blocked (unstyled overlay). |

**Transform**
| ID | Finding |
| --- | --- |
| `TRF-2` | Fixed Babel plugin set rejects valid TS/ES syntax that Vite accepts (`accessor`, `import assert`, `import defer`, `import source`); the module silently loses markers **and** its overlay import. |
| `TRF-3` | Parser failures swallowed with no signal; the "already compiled" warning is unreachable for client modules, misses Babel/SWC aliases, and false-positives on ordinary SSR code (`document.createElement`, text containing `jsx(`). |
| `TRF-4` | Idempotency guards are raw substring scans (`code.includes("data-ttc")`, overlay specifier): text in a comment/string can silently disable instrumentation for a file. |
| `TRF-5` | Deeply nested JSX overflows the recursive AST walk; the `RangeError` escapes the transform hook and breaks that module in dev. |
| `TRF-6` | Unconditional percent-decoding of module ids can retarget markers to a different in-root file (`src/%2e%2e/secret.tsx` → marker `secret.tsx`). |
| `TRF-7` | User `include`/`exclude` RegExps with `/g` or `/y` make instrumentation stateful/nondeterministic (`lastIndex`). |

**Dependencies / CI / release**
| ID | Finding |
| --- | --- |
| `DEP-5` | `stateDir`/`packageManagerStrict` in `pnpm-workspace.yaml` are silently ignored by pnpm 11; no `engines` on the root, package floor `node >=20` below the toolchain's 22.22 requirement. |
| `DEP-6` | `minimumReleaseAgeExclude` permanently exempts three runtime-critical Babel packages from the release-age quarantine, without comment or expiry. |
| `DEP-7` | Stale engine claims: dev/release toolchain needs Node ≥ 22.22.0, nothing pins or documents it. |
| `DEP-8` | `packages/tab-to-components/README.md` is a byte-identical duplicate of the root README, synced by hand. |
| `DEP-9` | Committed compatibility matrix says `0.3.0` while `0.4.0` is live, and is rewritten by a test script. |
| `DEP-10` | `verify-package.mjs` re-implements npm file selection and never inspects the real tarball (no allowlist/manifest/hash/secret scan) — assurance gap, not a vulnerability. |
| `DEP-11` | Build can leave a partial `dist/`; the client bundle is untyped at publish time; `prepublishOnly` runs only the build, not package verification. |
| `DEP-12` | Release runbook is git-ignored; no `SECURITY.md`/Dependabot; workspace/lockfile reference git-ignored `examples/`. |
| `DEP-13` | Gate/CI skip browser e2e and the `--browser` compatibility tier; Vite 6 is exercised only through Remix. |
| `DEP-14` | `nodeLinker: hoisted` + `autoInstallPeers` + `strictPeerDependencies: false` hide phantom dependencies and peer drift from the suite. |
| `DEP-15` | `pnpm gate` is not sandbox-safe: the repo's shim must be preloaded manually, no script does it. |
| `DEP-16` | `PUBLISHING.md` is stale and contains unsafe/contradictory release instructions. |

### 6.2 Info (13)

| ID | Finding |
| --- | --- |
| `SRV-11` | Invalid option values silently coerced (`overlay`, `ssr`, `menu`, `keyboard`, `clickActions`) — fail-open/quiet. |
| `SRV-12` | Dev-only guard is one-way: after a serve config resolves, a later build config is ignored and hooks stay active (serve-then-build in one process). |
| `SRV-13` | Input validation gaps: ADS paths, huge line/column values, control characters, UNC roots; reserved device names (`NUL`, `AUX`, `COM1`) are **refuted** (ENOENT). |
| `SRV-14` | HTTP protocol nits: no `Allow` on 405, OPTIONS intercepted by Vite CORS, absolute-form URLs ignored, duplicate `file` uses first, `+` decoded to space. |
| `CLI-11` | Event coverage gaps: `pointerdown`/`touchstart`/`dblclick` leak; `contextmenu` suppressed with nothing to show; nested-shadow targets unresolved. |
| `CLI-12` | Overlay isolation claims overstated: `[data-ttc-ui]` selector spoofable, open shadow root. |
| `CLI-13` | Marker/path helper edge cases: loose colon parse, unnormalized `..`, backslash mismatch, empty `copy-file`. |
| `TRF-8` | U+2028/U+2029 (and `</script>`) not escaped in generated marker/config strings — safe in module context, hardening note. |
| `TRF-9` | Overlay import shifts compiler-emitted `jsxDEV` source objects by one line (React DevTools/owner stacks point one line low). |
| `TRF-10` | No test-mode guard: Vitest runs the plugin as a dev server, so markers appear in test renders/snapshots. |
| `SKP-1` | README's custom-launcher example interpolates `file` into a URL without encoding (`README.md:254`) — copy-paste footgun. |
| `SKP-2` | `vite preview` resolves the plugin as `command:"serve"` but registers nothing (probed: SPA fallback, zero launches, no virtual-module leak) — state-machine note. |
| `SKP-3` | `test/plugin-middleware.test.ts:372` "under the Vite base only" overstates what it asserts; the unprefixed custom endpoint is untested and does match. |

---

## 7. What was checked and found clean

These were attacked and **refuted**, or verified safe — worth stating so the report is not read as "everything is broken":

- **No DOM-XSS sink** in the client runtime: zero `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval`/`new Function`/`document.write` sinks; marker/name payloads render via `textContent`.
- **No prototype pollution** in config merging; non-object configs and getter traps fail closed or throw predictably.
- **No production leakage:** `apply:"serve"` plus per-hook guards keep markers, the virtual client module and the endpoint out of `vite build`/`react-router build`; the packaged consumer test confirms it. `dist/client.js` evaluated without config attaches nothing.
- **No transform code injection:** every dynamic string in generated output goes through `JSON.stringify` or is a constant attribute name; quotes, backslashes, CR/LF, template sequences, `</script>`, U+2028/2029 and emoji round-trip and reparse. Source maps are aligned; overlay insertion after directives/shebang/`"use client"` is correct; 1,314 fuzzed shapes produced no `MagicString` overlap/out-of-range.
- **No path traversal through the custom endpoint:** `..`, absolute-outside, sibling-prefix root, UNC, `\\?\`, `file://`, encoded dots, trailing dot/space, zero/overflow positions all rejected (nine bypass classes re-tested). The escapes are only pre-existing junctions (`SRV-6`) and `auto` mode (`SRV-5`).
- **Production/dev-only guards hold under `vite preview`** (no endpoint, no client module) and under SSR/hydration in happy-dom with real React 18.3.1/19.3.1.
- **No critical/high advisory in runtime dependencies** (`@babel/parser` 7.29.11, `@babel/types` 7.29.11, `magic-string` 0.30.21, installed Vite 8.3.5/7.3.7, vitest 5.0.5, rolldown 1.2.15, plugin-react 6.1.2). All five lockfiles use 100% registry tarballs with sha512 integrity; no install scripts run; no secrets/absolute user paths in tracked history.
- **Packaging allowlist is clean:** 21 files / 119,045 B, no source maps, no `src/`/`test/`/`scripts/`/`.tmp`, and the packed artifact boots a dev server.

---

## 8. Remediation plan

### P0 — before the next release

1. **Rewrite the Windows launcher** (`SRV-1`, `SRV-3`): absolute executable resolution, `spawn(exe, args)` without a shell, launch-editor-grade escaping for `.cmd` shims, reject metacharacters/`%`/CR-LF/UNC in the target path, neutral `cwd`. Unit + end-to-end carrier tests.
2. **Authenticate/origin-check the endpoint** (`SRV-2`): `POST`-only + per-server token, `Origin`/`Sec-Fetch-Site` allowlist derived from resolved dev-server origins, rate limit/dedupe, async `stat`. Add tests with forged headers, LAN Host and `allowedHosts`.
3. **Release-provenance fix** (`DEP-3`): clean-tree + tag assertion before publish, tagged CI release with `npm/pnpm publish --provenance`, tag `v0.4.0`/`v0.4.1`, publish 0.4.1 from a clean tagged tree.

### P1 — next maintenance window

4. **Marker trust** (`CLI-1`, `SRV-5`): client-side marker validation (reject `..`, absolute, backslashes as separators, control characters); auto mode either validates before Vite's endpoint or documents the inherited trust model; correct the README containment claim.
5. **Compiled-JSX fallback** (`TRF-1`): callee/shape verification for `jsxDEV`/`jsx`/`jsxs`/`createElement` and aliases, no `null`-props rewrite outside a confirmed call, decoy tests.
6. **CI hardening** (`DEP-2`, `DEP-5`): SHA-pinned actions, least-privilege `permissions`, `persist-credentials: false`, `timeout-minutes`, enforced Node/pnpm versions, OSV/audit scanner in the gate, upgrade the Remix fixture's `tar`/`vite`/`esbuild` (`DEP-4`).
7. **Silent failure cleanup** (`SRV-8` + folded `CLI-8`): return non-200 when a launch fails, surface the error in the terminal, add a client fetch timeout and opaque-response handling.

### P2 — hardening / cleanup

8. Config validation (`SRV-7`, `SRV-9`, `SRV-11`, `CLI-6`): validate every option, require the endpoint to match under the base (or document the alias), reject empty/`?`/`#` endpoints at startup.
9. Containment (`SRV-6`, `TRF-6`): compare `realpathSync.native` of root and target (keep the lexical fast path), and stop unconditional percent-decoding of module ids.
10. Transform reliability (`TRF-2`–`TRF-5`, `TRF-7`, `TRF-9`, `TRF-10`): widen the parser plugin set and warn on parse failure; pre-tokenized comment/string-aware idempotency checks; iterative or depth-limited walk; normalize user regex flags; fix the overlay-import line shift; skip instrumentation for Vitest unless opted in.
11. Client polish (`CLI-2`–`CLI-5`, `CLI-7`, `CLI-9`–`CLI-13`): sanitize copied/displayed marker text, clear `suppressNextClick` on Escape/blur, restore focus, observe `body` replacement, clean boot globals on uninstall, handle throwing descriptors, cover pointer/touch/dblclick events.
12. Docs/release hygiene (`DEP-6`–`DEP-16`, `SKP-1`–`SKP-3`): fix the README encoding example, de-duplicate the README, refresh the compatibility matrix, publish a `SECURITY.md`, track or replace the release runbook, make `verify:package` inspect a real packed tarball.

### Test gaps to close with the fixes

No confirmed exploit has a regression test today: quoting/metacharacter paths, Origin/Sec-Fetch-Site/LAN headers, hostile `data-ttc`, non-JSX 5-arg decoys, junction/symlink containment, `editorEndpoint` edge values, launch-failure status codes, and the `/g` regex case are all untested. The verifier mapped each finding to its missing test in `.tmp/security-audit/verification.md` §4.

---

## 9. Coverage, evidence and limitations

**Reviewed:** all 19 source files under `packages/tab-to-components/src/` (server runtime, browser client, transform, virtual module, types), all 4 build/dev scripts, all 30 test files, root/package manifests, workspace config, 5 lockfiles, CI workflow, packaging scripts, README/DEVELOPMENT/PUBLISHING/docs, plus `compat/*` and `playground/*` fixtures.

**Evidence produced:** 1 baseline report, 4 area reports (53 findings, 58 entries with duplicates, 15 refuted candidates worth recording), 1 verification report (11/12 critical-high-medium confirmed by independent execution, 0 refuted), 1 adversarial review (51 distinct after dedupe, 3 new info items, severity corrections), and ~120 PoC/log files under `.tmp/security-audit/`.

**Not verified (evidence gaps, not defects):**
- No real browser (no Chrome/Playwright): focus, clipboard side effects, shadow-DOM retargeting, drag-without-click and browser-enforced Private Network Access are happy-dom/spec-reasoned.
- Vite 6/7 dev-server behavior: the Vite 7 matrix tier self-skips in this sandbox; Vite 6 is exercised only through the Remix fixture. Statements about those versions are source-traced.
- macOS/Linux runtime: the high finding is Windows-only by construction (POSIX uses an argv spawn); symlink/`realpath` behavior differs and was not executed on macOS.
- React Compiler and streamed-SSR real-browser hydration; TanStack Start dev-SSR flow.
- The published 0.4.0 tarball itself was not downloaded/inspected — `DEP-3` is metadata-level.
- CI workflow behavior was statically inspected, not executed on GitHub.

**Threat-model caveat:** several low items (`CLI-6`, `CLI-7`, `CLI-12`, part of `CLI-1`) only matter to a script that already runs in the dev page; they are listed as defense-in-depth, not as remote boundaries.

---

## 10. Artefacts

All under `.tmp/security-audit/` (git-ignored; delete freely):

| Path | Contents |
| --- | --- |
| `baseline.md` + `logs/` | Environment, command matrix, pass/fail evidence, environment caveats. |
| `findings-server.md` (`SRV-1`…`SRV-14`) | Server endpoint, launcher, path containment; 32 evidence logs in `poc-server/logs/`. |
| `findings-client.md` (`CLI-1`…`CLI-13`) | Browser runtime; 15 PoC files / 85 tests in `poc-client/`; reference notes from `poc-transform/`. |
| `findings-transform.md` (`TRF-1`…`TRF-10`) | Transform/parser; 20 PoCs in `poc-transform/`. |
| `findings-deps-ci.md` / `.json` (`DEP-1`…`DEP-16`) | Supply chain, CI, packaging, release. |
| `verification.md` + `verify/` + `logs/t6-*` | Independent reproduction of every critical/high/medium claim. |
| `review.md` + `poc-review/` | Adversarial review, dedupe map, severity calibration, coverage matrix. |

**Verified external facts:** GHSA-587h-7wmj-h5pm / CVE-2026-112942 (launch-editor `<=2.14.1`, Vite fixed 6.4.4 / 7.3.7 / 8.1.6 / 8.2.4 / 8.3.3; CVSS4 7.5) · GHSA-v6wh-96g9-6wx3 / CVE-2026-53632 (launch-editor `<=2.14.0`, NTLMv2 disclosure, MEDIUM) · GHSA-34x7-hfp2-rc4v / CVE-2026-24842 (`tar <7.5.7`, HIGH) · npm registry: `0.4.0` `gitHead` `533a634` (tree version `0.3.0`), published 2026-10-25T09:05:25Z; `0.3.0` shares `0.2.0`'s `gitHead`; no git tags; no attestations.

---

## 11. Remediation status — 0.4.1 (post-audit)

The high and medium findings were fixed after this audit under `tab-to-components@0.4.1` with no API changes. The audit above remains the point-in-time record; this table tracks what changed.

| ID | Status | Change |
| --- | --- | --- |
| `SRV-1` (high) | **Fixed** | Windows launcher rewritten: executable resolved to an absolute path, `.exe`/`.com` spawned without a shell, `.cmd`/`.bat` shims run through `cmd.exe /d /s /c` with caret escaping and `%`/CR-LF rejection; metacharacters in a project/dependency filename no longer become commands. Binary-planting (`SRV-3`) closed by PATH-only resolution and refusing executables inside the project tree. Regression tests: `test/editor.test.ts` command-line/plan cases. |
| `SRV-2` (medium) | **Fixed** | Endpoint rejects `Sec-Fetch-Site: cross-site/same-site` and mismatched `Origin`, coalesces duplicate launches and caps at 20 launches / 5 s (429 above), and warns when the dev server is exposed beyond localhost. Browser CSRF/drive-by is blocked; non-browser clients (no headers) remain allowed by design, and LAN/tunnel exposure still needs the documented host binding. |
| `SRV-5` + `CLI-1` (medium) | **Fixed** | `editor: "auto"` requests to `/__open-in-editor` are containment-checked before delegation to Vite; the browser refuses absolute, UNC, `..` and malformed markers before sending any request. Residual: a page script can still spoof the *displayed* label (cosmetic, same privilege as the page). |
| `TRF-1` (medium) | **Fixed** | The compiled-JSX fallback only rewrites `jsxDEV`/`jsx`/`jsxs` (and Babel `_`-aliases); unrelated five-argument calls are untouched and `null` props are only replaced on a confirmed JSX call. Decoy tests added. |
| `DEP-1` (medium) | **Mitigated** | README (both copies) documents the Vite/launch-editor advisory windows and patched floors; CI audits the published package's production dependencies. Peer range intentionally unchanged to avoid a breaking install for users on older Vite. |
| `DEP-2` (medium) | **Fixed** | CI actions pinned to commit SHAs, top-level `permissions: contents: read`, `persist-credentials: false`, `timeout-minutes`, and an audit step. |
| `DEP-3` (medium) | **Fixed (process)** | `prepublishOnly` runs a release guard (clean tracked tree + `v<version>` tag at HEAD); a tag-driven release workflow publishes with npm provenance. The already-published 0.4.0 artifact remains untraceable — publish 0.4.1 from a tagged commit. |
| `DEP-4` (medium) | **Mitigated / documented** | The fixture advisories (`vite-node`→Vite 5.4.21, `tar` 6.2.1, `esbuild` 0.17.6) are reachable only through the Remix compatibility build and are not attacker-relevant; upgrading them requires a Remix toolchain change. DEVELOPMENT.md documents the rationale; production dependencies are audited in CI. |

Verification after the fixes (same machine/toolchain): `build` exit 0, `typecheck` 0 diagnostics, unit **406 passed / 1 skipped**, integration **31 passed**, Vite matrix **8 passed / 10 skipped** (sandbox), `verify:package` **60/60**, compatibility matrix **9/10 verified, 0 failing** (Remix v2 cell not verified in this sandbox, as before). No source API, option or output-format changes.

---

*Audit performed 2026-10-25 against `4df767d`. No tracked file was modified during the audit itself; this report was added as its only artefact. The remediation described in §11 was implemented afterwards under 0.4.1.*
