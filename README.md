# opencode-http-capture

> Inspect OpenCode model requests locally, without a proxy.

This OpenCode plugin intercepts model requests passing through its fetch wrapper, saves redacted JSON to temporary files, and blocks those requests. Use it to study OpenCode conversation prompts, message structure, tool definitions, generation parameters, and more.

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

Start OpenCode with capture enabled:

```bash
OPENCODE_CAPTURE=1 opencode
```

To inspect an existing Session without appending to it, use a fork:

```bash
OPENCODE_CAPTURE=1 opencode run --session ses_xxx --fork "Continue"
```

## Get results

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
OPENCODE_CAPTURE=1 OPENCODE_CAPTURE_DIR=/tmp/my-captures opencode
```

## Disable capture

Exit and restart OpenCode without `OPENCODE_CAPTURE`. Normal use is unaffected.

## Uninstall

```bash
bash uninstall.sh
```

Restart OpenCode afterwards. Capture files are retained for you to inspect and remove.

## License

[AGPL-3.0-or-later](LICENSE).
