# opencode-http-capture

> Inspect OpenCode model requests locally, without a proxy.

This OpenCode plugin is disabled by default. Choose `block` to capture and block model requests, saving redacted JSON to temporary files, or `record` / `all` to forward real traffic while recording requests and responses. Use it to study prompts, message structure, tool definitions, and generation parameters.

[简体中文](README.zh-cn.md) · [Specification](SPEC.md) · [Agent guidelines](AGENTS.md)

## Install

Requirements: OpenCode v1 with external plugin support.

```bash
git clone git@github.com:hymsk/opencode-http-capture.git
cd opencode-http-capture
bash install.sh
```

The installer creates a symlink in `~/.config/opencode/plugins/`. Keep this checkout in place and restart OpenCode after installation. Use `OPENCODE_CONFIG_DIR` with the installer to select a different configuration directory.

## Usage

Select a mode with a single environment variable:

| `OPENCODE_CAPTURE` | Behavior |
| --- | --- |
| unset, empty, `false`, `0` | Disabled; fetch is unchanged |
| `block` | Capture and block model requests; forward other requests |
| `record` | Forward real traffic; record model requests and responses only |
| `all` | Forward real traffic; record all requests and responses handled by this fetch wrapper |

Values are exact and case-sensitive; whitespace is not trimmed. Any other nonempty value (except legacy `1` / `true`, below) throws an explicit configuration error before installation instead of silently disabling capture or selecting another mode. This rejects plugin initialization, not a process-wide network firewall; do not ignore plugin-load errors.

Start OpenCode with model requests blocked:

```bash
OPENCODE_CAPTURE=block opencode
```

To inspect an existing Session without appending to it, use a fork:

```bash
OPENCODE_CAPTURE=block opencode run --session ses_xxx --fork "Continue"
```

## Record real requests and responses

```bash
OPENCODE_CAPTURE=record opencode

# All requests passing through this fetch wrapper, not just model requests
OPENCODE_CAPTURE=all opencode
```

**Both `record` and `all` call real providers, incur costs, and may execute tools.** `--fork` protects the original Session, not external systems or files from tool effects. Without an opt-in, the plugin remains disabled.

The recording directory is printed to stderr on startup. Each request has an `<ID>.json` file. Responses remain streaming; captured response bodies are saved after consumption finishes **without redaction**. Request headers/body and response metadata (including headers) retain credential redaction. Check `state` and request/response `bodyState`; pending/streaming artifacts are incomplete. Recording failures do not block traffic.

The default body limit is 1 MiB per request/response, configurable via the positive integer `OPENCODE_CAPTURE_MAX_BYTES`. Complete JSON responses are parsed and saved without redaction. SSE (`text/event-stream`) and other `text/*` responses are saved as UTF-8 text, preserving event framing, whitespace and content without protocol reconstruction. Decoding happens after buffering, so chunk boundaries do not affect recorded text; invalid UTF-8 uses replacement characters. Response bytes delivered to the caller remain unchanged. Binary and unrecognized/missing content types are omitted (`omitted-unsupported`); malformed JSON is omitted (`omitted-unparseable`). Oversized or interrupted bodies are omitted entirely (`omitted-limit` / `omitted-incomplete`), never saved as partial prefixes. `bodyState=complete` means the supported body was saved (including empty text); `empty` means no response body stream. Only JSON strings supplied as `init.body` are recorded as request bodies; existing Request bodies and upload streams are not consumed. Use all scope for metadata on unknown endpoints with these bodies.

Request snapshots accept ordinary data-property options and safely re-readable Headers, string records, or string-pair arrays. One-shot iterators, getters, Proxies and other unsafe-to-inspect inputs bypass recording entirely, even in all scope. Locked, used or unwrappable responses pass through unchanged with recording marked unavailable. Instance `clone()` preserves response metadata using native stream tee/cancellation. The recorder retains a bounded byte buffer, not per-chunk objects; growth, text/JSON processing and caller-created clone queues still use additional memory. Common private-key fields and PEM private keys are redacted in requests and response metadata only; arbitrary secrets there are not guaranteed to be detected.

All scope does not cover WebSockets, subprocesses, or networking that bypasses fetch. This is not a process-wide packet capture or a byte-for-byte archive. **Response bodies deliberately preserve all content, including any API keys, tokens, URLs, personal data or other secrets returned by the provider. Users assume responsibility for this sensitive-data risk and for secure storage, access and deletion.** Requests may still contain sensitive prompts, code and tool results despite credential redaction. Do not publish captures. There is no automatic rotation or cleanup; monitor disk usage during long recording sessions.

## Get results (block mode)

For Chat Completions, the assistant response is the absolute capture file path:

```text
/tmp/opencode-http-capture-AbCdEf/1.json
```

Inspect or save the request body with `jq`:

```bash
jq '.request.body' /tmp/opencode-http-capture-AbCdEf/1.json
jq '.request.body' /tmp/opencode-http-capture-AbCdEf/1.json > request.json
```

To choose a capture parent directory, create it first:

```bash
mkdir -p /tmp/my-captures
OPENCODE_CAPTURE=block OPENCODE_CAPTURE_DIR=/tmp/my-captures opencode
```

`OPENCODE_CAPTURE_DIR` is optional for every enabled mode; the default parent is the system temporary directory. `OPENCODE_CAPTURE_MAX_BYTES` is optional for recording (`record` / `all`), not used by `block`.

## Legacy compatibility

Only `OPENCODE_CAPTURE=1` or `true` reads `OPENCODE_CAPTURE_MODE` (`block` by default, or `record`) and `OPENCODE_CAPTURE_SCOPE` (`model` by default, or `all`, recording only). Thus the old `OPENCODE_CAPTURE=1 OPENCODE_CAPTURE_MODE=record` command still records rather than blocks; adding `OPENCODE_CAPTURE_SCOPE=all` still records all fetch traffic. Invalid legacy MODE, or invalid SCOPE when recording, throws a configuration error.

New `block` / `record` / `all` values ignore MODE and SCOPE entirely, even conflicting or invalid values. Disabled values also ignore them. Directory and recording size settings remain optional. Installation is deduplicated per process; restart OpenCode to switch modes or disable an already installed wrapper.

## Disable capture

Exit and restart OpenCode without `OPENCODE_CAPTURE`, or set it to an empty string, `false` or `0`. Normal use is unaffected.

## Uninstall

```bash
bash uninstall.sh
```

Restart OpenCode afterwards. Capture files are retained for you to inspect and remove.

## License

[AGPL-3.0-or-later](LICENSE).
