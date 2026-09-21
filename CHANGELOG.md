# Changelog

Version history is kept newest first. A source version does not imply an npm publication; distribution status is noted explicitly below.

## 0.1.1 — first npm release (unreleased)

This is the first npm distribution target, not a claim that the package is already published. The `0.x` version is an early release, not a general compatibility guarantee.

### Distribution

- Install through OpenCode's `plugin` configuration, pinned to `opencode-http-capture@0.1.1` after publication.
- Publish built ESM JavaScript with an explicit package entry and release-file allowlist. Consumers need no build or installation scripts.
- Keep local checkout/symlink installation available; remove the old symlink before switching to npm.
- Use a dependency-free Node.js 24+ build/test toolchain; replace the earlier unverified Node.js `>=20` declaration. Remove the unused `@opencode-ai/plugin` peer dependency.

### Changes since the initial 0.1.0 baseline

- Add explicit `block`, `record`, and `all` modes while keeping capture disabled by default and preserving legacy `1` / `true` configuration.
- Add opt-in recording of real requests and streaming JSON/SSE/text responses alongside the existing request-blocking mode.
- Extend credential redaction to response metadata and common private-key fields; intentionally retain recorded response bodies without redaction.
- Bound recorded body sizes, preserve streaming/cancellation/clone behavior, and avoid blocking real traffic on recording failures.
- Deduplicate concurrent installation and allow retry after failed installation.

The recording implementation was developed while `package.json` still declared `0.1.0`; it is grouped here for the planned `0.1.1` release rather than presented as a separately published `0.1.0` update.

### Safety and limitations

- Recording calls real providers, may incur costs and execute tools. Forking protects the original Session, not external side effects.
- Response bodies may contain secrets. Captures require secure storage and manual cleanup; never publish real captures.
- Only wrapped `globalThis.fetch` traffic is covered, not WebSockets, subprocesses or all network I/O.
- The automated suite passed 36 checks on Node.js 24.13.0 / npm 11.6.2, including offline tarball installation. Isolated OpenCode 1.18.31 acceptance passed for block, record and all using a loopback-only fictional provider; no real provider was called. Registry publication is a separate release check; see [RELEASING.md](RELEASING.md).

## 0.1.0 — initial local-install baseline

Initial source baseline: [`635472d`](https://github.com/hymsk/opencode-http-capture/commit/635472d9033a46b487b369c980549e219c47b9b0). This records the original `package.json` version, not an npm release or an inferred release date.

### Added

- A local OpenCode plugin installed through a symlink with `install.sh`, with a guarded `uninstall.sh` that only removes this checkout's link.
- Opt-in model-request capture and blocking through `globalThis.fetch`, enabled with `OPENCODE_CAPTURE=1` or `true`; disabled by default.
- Redacted request JSON written to private temporary files. OpenAI-compatible Chat Completions receive a synthetic answer containing the capture path; other recognized model protocols receive an error containing that path.
- Forward non-model fetch requests so plugin/MCP discovery can continue; do not forward captured model requests even when capture fails.
- Optional capture parent directory, bilingual usage documentation, behavior specification, mocked-fetch tests and the AGPL-3.0-or-later license.

### Scope

- Local checkout installation only; no npm package entry or built JavaScript distribution in this baseline.
- No response recording in the initial baseline. Forking is recommended to protect the original Session; capture is not a process-wide network sandbox.
