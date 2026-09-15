import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installCapture } from "../src/plugin.ts"

test("capture and block model fetch while forwarding non-model fetch", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-http-capture-test-"))
  let forwarded = 0
  const host = { fetch: async () => { forwarded++; return new Response("forwarded") } }
  try {
    const directory = await installCapture(host, root)
    const response = await host.fetch("https://provider.test/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer secret" }, body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hello" }] }) })
    const file = (await response.json()).choices[0].message.content
    assert.equal(file, join(directory, "1.json"))
    const artifact = JSON.parse(await readFile(file, "utf8"))
    assert.equal(artifact.blocked, true)
    assert.equal(artifact.request.headers.authorization, "[REDACTED]")
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.equal(forwarded, 0)
    assert.equal(await (await host.fetch("https://example.test/mcp")).text(), "forwarded")
    assert.equal(forwarded, 1)
  } finally { await rm(root, { recursive: true }) }
})
