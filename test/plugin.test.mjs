import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installCapture, redact } from "../dist/plugin.js"
import { installRecorder } from "../dist/record.js"
import entry from "../dist/entry.js"

const entryEnv = ["OPENCODE_CAPTURE", "OPENCODE_CAPTURE_MODE", "OPENCODE_CAPTURE_DIR", "OPENCODE_CAPTURE_SCOPE", "OPENCODE_CAPTURE_MAX_BYTES"]
const installedKey = Symbol.for("opencode-http-capture.installed")

async function entryFixture(options, run) {
  const previous = entryEnv.map((key) => process.env[key])
  const installed = globalThis[installedKey], fetch = globalThis.fetch
  const root = await mkdtemp(join(tmpdir(), "capture-entry-test-"))
  const calls = []
  const original = async (...args) => { calls.push(args); return Response.json({ ok: true }) }
  try {
    entryEnv.forEach((key) => { delete process.env[key] })
    delete globalThis[installedKey]
    globalThis.fetch = original
    process.env.OPENCODE_CAPTURE_DIR = root
    for (const [name, value] of Object.entries(options)) {
      if (value !== undefined) process.env[`OPENCODE_CAPTURE${name ? `_${name}` : ""}`] = value
    }
    await run({ root, calls, original })
  } finally {
    globalThis.fetch = fetch
    if (installed === undefined) delete globalThis[installedKey]; else globalThis[installedKey] = installed
    entryEnv.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i] })
    await rm(root, { recursive: true })
  }
}

test("entry disables unset, empty, false and 0 regardless of legacy options", async () => {
  for (const capture of [undefined, "", "false", "0"]) {
    await entryFixture({ "": capture, MODE: "invalid", SCOPE: "invalid", MAX_BYTES: "0" }, async ({ root, original, calls }) => {
      assert.deepEqual(await entry(), {})
      assert.equal(globalThis.fetch, original)
      assert.equal(globalThis[installedKey], undefined)
      assert.deepEqual(await readdir(root), [])
      assert.equal(calls.length, 0)
    })
  }
})

async function assertEntryRouting(options, mode, scope) {
  await entryFixture(options, async ({ root, calls }) => {
    assert.deepEqual(await entry(), {})
    const init = { method: "POST", body: '{"messages":[]}' }
    const response = await globalThis.fetch("https://provider.test/v1/chat/completions", init)
    const body = await response.json()
    assert.equal(calls.length, mode === "block" ? 0 : 1)
    assert.deepEqual(await (await globalThis.fetch("https://fixture.test/mcp")).json(), { ok: true })
    assert.equal(calls.length, mode === "block" ? 1 : 2)
    const directories = await readdir(root)
    assert.equal(directories.length, 1)
    const directory = join(root, directories[0])
    assert.deepEqual((await readdir(directory)).sort(), scope === "all" ? ["1.json", "2.json"] : ["1.json"])
    const artifact = JSON.parse(await readFile(join(directory, "1.json"), "utf8"))
    assert.equal(artifact.blocked, mode === "block")
    if (mode === "block") assert.equal(body.choices[0].message.content, join(directory, "1.json"))
    else {
      assert.deepEqual(body, { ok: true })
      assert.equal(calls[0][1], init)
      assert.deepEqual(artifact.response.body, { ok: true })
    }
  })
}

test("entry single-parameter modes select routing and ignore conflicting or invalid legacy options", async () => {
  for (const capture of ["block", "record", "all"]) {
    for (const [mode, scope] of [[undefined, undefined], ["block", "model"], ["record", "all"], ["invalid", "invalid"]]) {
      await assertEntryRouting({ "": capture, MODE: mode, SCOPE: scope }, capture === "block" ? "block" : "record", capture === "all" ? "all" : "model")
    }
  }
})

test("entry legacy 1/true preserve MODE/SCOPE combinations and defaults", async () => {
  for (const capture of ["1", "true"]) {
    for (const mode of [undefined, "block", "record"]) {
      for (const scope of [undefined, "model", "all"]) {
        await assertEntryRouting({ "": capture, MODE: mode, SCOPE: scope }, mode ?? "block", mode === "record" ? scope ?? "model" : "model")
      }
    }
    await assertEntryRouting({ "": capture, MODE: "block", SCOPE: "invalid", MAX_BYTES: "0" }, "block", "model")
    for (const [options, error] of [[{ MODE: "invalid" }, /Invalid OPENCODE_CAPTURE_MODE/], [{ MODE: "record", SCOPE: "invalid" }, /Invalid OPENCODE_CAPTURE_SCOPE/]]) {
      await entryFixture({ "": capture, ...options }, async ({ root, calls, original }) => {
        await assert.rejects(entry(), error)
        assert.equal(globalThis.fetch, original)
        assert.equal(globalThis[installedKey], undefined)
        assert.deepEqual(await readdir(root), [])
        assert.equal(calls.length, 0)
      })
    }
  }
})

test("entry rejects unsupported nonempty capture values before installation, even with a dedup marker", async () => {
  for (const capture of ["invalid", "2", "TRUE", "FALSE", "Record", " ", " record "]) {
    await entryFixture({ "": capture, MODE: "record" }, async ({ root, calls, original }) => {
      for (const marker of [undefined, true]) {
        if (marker === undefined) delete globalThis[installedKey]; else globalThis[installedKey] = marker
        await assert.rejects(entry(), /Invalid OPENCODE_CAPTURE: expected block, record, all, 1, true, false, 0 or an empty value/)
        assert.equal(globalThis.fetch, original)
        assert.equal(globalThis[installedKey], marker)
      }
      assert.deepEqual(await readdir(root), [])
      assert.equal(calls.length, 0)
    })
  }
})

test("record options reject invalid scopes and limits without replacing fetch", async () => {
  const fetch = async () => new Response("ok")
  const host = { fetch }
  for (const options of [{ scope: "invalid" }, { maxBytes: 0 }, { maxBytes: NaN }, { maxBytes: 1.5 }]) {
    await assert.rejects(installRecorder(host, tmpdir(), options), /Invalid capture record options/)
    assert.equal(host.fetch, fetch)
  }
})

test("record does not consume one-shot headers or invoke request getters", async () => {
  function* headers() { yield ["x-fixture", "present"] }
  let reads = 0
  for (const init of [
    { headers: headers() },
    { get headers() { reads++; return { "x-fixture": "present" } } },
    { headers: { get "x-fixture"() { reads++; return "present" } } },
    { headers: [["x-fixture", { toString() { reads++; return "present" } }]] },
    new Proxy({ headers: { "x-fixture": "present" } }, { get(target, key) { reads++; return target[key] } }),
  ]) {
    const before = reads
    await recording(async (host) => {
      assert.equal(await (await host.fetch("https://provider.test/messages", init)).text(), "ok")
    }, async (_, actual) => {
      assert.equal(reads, before)
      assert.equal(actual, init)
      assert.equal(new Headers(actual.headers).get("x-fixture"), "present")
      return new Response("ok")
    })
  }
})

test("standard re-readable headers are captured without modifying inputs", async () => {
  for (const headers of [new Headers({ "x-fixture": "present" }), { "x-fixture": "present" }, [["x-fixture", "present"]]]) {
    const init = { headers }
    await recording(async (host, artifact) => {
      await (await host.fetch("https://provider.test/messages", init)).text()
      assert.equal((await artifact()).request.headers["x-fixture"], "present")
    }, async (_, actual) => {
      assert.equal(actual, init)
      assert.equal(new Headers(actual.headers).get("x-fixture"), "present")
      return new Response("ok")
    })
  }
})

test("redact covers common private key names and fictional PEM values", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nFICTIONAL-NOT-A-KEY\n-----END RSA PRIVATE KEY-----"
  assert.deepEqual(redact({ private_key: "fixture", privateKey: "fixture", secret_access_key: "fixture", secretAccessKey: "fixture", text: pem }),
    { private_key: "[REDACTED]", privateKey: "[REDACTED]", secret_access_key: "[REDACTED]", secretAccessKey: "[REDACTED]", text: "[REDACTED]" })
  for (const label of ["PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY", "OPENSSH PRIVATE KEY"]) {
    assert.equal(redact(`prefix -----BEGIN ${label}-----\nFICTIONAL-ONLY\n-----END ${label}----- suffix`), "prefix [REDACTED] suffix")
  }
  assert.equal(redact("-----BEGIN PRIVATE KEY-----\nFICTIONAL-INCOMPLETE"), "[REDACTED]")
})

test("SSE cross-event content is recorded verbatim without protocol reconstruction", async () => {
  const text = 'data: {"delta":"sk-"}\n\ndata: {"delta":"fictional-only"}\n\ndata: [DONE]\n\n'
  await recording(async (host, artifact) => {
    assert.equal(await (await host.fetch("https://provider.test/messages")).text(), text)
    const data = await artifact()
    assert.equal(data.response.bodyState, "complete")
    assert.equal(data.response.body, text)
  }, async () => new Response(text, { headers: { "content-type": "text/event-stream" } }))
})

test("locked, consumed and unwrappable responses are returned unchanged", async () => {
  const locked = Response.json({ ok: true })
  const lock = locked.body.getReader()
  const used = Response.json({ ok: true })
  await used.text()
  const invalid = Response.json({ ok: true })
  Object.defineProperty(invalid, "status", { value: 0 })
  try {
    for (const original of [locked, used, invalid]) {
      await recording(async (host, artifact) => {
        assert.equal(await host.fetch("https://provider.test/messages"), original)
        assert.equal((await artifact()).response.bodyState, "omitted-unavailable")
      }, async () => original)
    }
    assert.equal(invalid.body.locked, false)
    assert.deepEqual(await invalid.json(), { ok: true })
  } finally { lock.releaseLock() }
})

test("Response clones preserve metadata and native tee cancellation", async () => {
  let cancelled
  const original = new Response(new ReadableStream({ cancel(reason) { cancelled = reason } }))
  for (const [key, value] of Object.entries({ url: "https://fixture.test/final", redirected: true, type: "cors" })) {
    Object.defineProperty(original, key, { value })
  }
  await recording(async (host, artifact) => {
    const response = await host.fetch("https://provider.test/messages")
    const clone = response.clone(), nested = clone.clone()
    for (const item of [response, clone, nested]) {
      assert.equal(item.url, original.url)
      assert.equal(item.redirected, true)
      assert.equal(item.type, "cors")
    }
    const a = response.body.cancel("a"), b = clone.body.cancel("b")
    assert.equal(cancelled, undefined)
    await Promise.all([a, b, nested.body.cancel("c")])
    assert.deepEqual(cancelled, ["a", ["b", "c"]])
    assert.equal((await artifact()).state, "cancelled")
  }, async () => original)
})

test("clones independently consume the same bytes and reject clone after locking or use", async () => {
  await recording(async (host, artifact) => {
    const response = await host.fetch("https://provider.test/messages")
    const clone = response.clone()
    const lock = response.body.getReader()
    assert.throws(() => response.clone(), TypeError)
    lock.releaseLock()
    const values = await Promise.all([response.text(), clone.text()])
    assert.deepEqual(values, ['{"ok":true}', '{"ok":true}'])
    assert.throws(() => clone.clone(), TypeError)
    assert.equal((await artifact()).state, "complete")
  }, async () => Response.json({ ok: true }))
})

test("recorder allocation failure does not fail response consumption", async () => {
  await recording(async (host, artifact) => {
    const response = await host.fetch("https://provider.test/messages")
    const alloc = Buffer.alloc
    try {
      Buffer.alloc = () => { throw new Error("fictional allocation failure") }
      assert.equal(await response.text(), '{"ok":true}')
    } finally { Buffer.alloc = alloc }
    assert.equal((await artifact()).response.bodyState, "omitted-unavailable")
    assert.equal((await artifact()).response.body, undefined)
  }, async () => Response.json({ ok: true }))
})

test("cancel during pending read settles read and forwards cancellation", async () => {
  let pulling, cancelled
  const started = new Promise((resolve) => { pulling = resolve })
  await recording(async (host, artifact) => {
    const response = await host.fetch("https://provider.test/messages")
    const reader = response.body.getReader()
    const pending = reader.read()
    await started
    await reader.cancel("pending-stop")
    assert.deepEqual(await pending, { done: true, value: undefined })
    assert.equal(cancelled, "pending-stop")
    assert.equal((await artifact()).state, "cancelled")
  }, async () => new Response(new ReadableStream({ pull() { pulling() }, cancel(reason) { cancelled = reason } }, { highWaterMark: 0 })))
})

test("entry shares in-flight installation and permits retry after failure", async () => {
  for (const capture of ["block", "record", "all", "1", "true"]) {
    await entryFixture({ "": capture, MODE: "record", SCOPE: "all", MAX_BYTES: "1024" }, async ({ root, original, calls }) => {
      process.env.OPENCODE_CAPTURE_DIR = join(root, "absent")
      const attempts = await Promise.allSettled([entry(), entry()])
      assert.deepEqual(attempts.map((result) => result.status), capture === "block" ? ["rejected", "rejected"] : ["fulfilled", "fulfilled"])
      if (capture === "block") {
        assert.equal(attempts[0].reason.code, "ENOENT")
        assert.equal(attempts[0].reason, attempts[1].reason)
      }
      assert.equal(globalThis[installedKey], undefined)
      assert.equal(globalThis.fetch, original)
      process.env.OPENCODE_CAPTURE_DIR = root
      await Promise.all([entry(), entry(), entry()])
      assert.equal((await readdir(root)).length, 1)
      assert.equal(globalThis[installedKey], true)
      const wrapped = globalThis.fetch
      await entry()
      assert.equal(globalThis.fetch, wrapped)
      assert.equal((await readdir(root)).length, 1)
      assert.equal(calls.length, 0)
    })
  }
})

test("entry retries corrected configuration without leaving a wrapper or installation marker", async () => {
  for (const capture of ["record", "all", "1", "true"]) {
    await entryFixture({ "": "typo", MODE: "record", MAX_BYTES: "0" }, async ({ root, calls, original }) => {
      await assert.rejects(entry(), /Invalid OPENCODE_CAPTURE:/)
      process.env.OPENCODE_CAPTURE = capture
      await assert.rejects(entry(), /Invalid capture record options/)
      assert.equal(globalThis[installedKey], undefined)
      assert.equal(globalThis.fetch, original)
      assert.deepEqual(await readdir(root), [])
      process.env.OPENCODE_CAPTURE_MAX_BYTES = "4"
      await entry()
      assert.equal((await readdir(root)).length, 1)
      assert.deepEqual(await (await globalThis.fetch("https://provider.test/messages")).json(), { ok: true })
      const directory = join(root, (await readdir(root))[0])
      assert.equal(JSON.parse(await readFile(join(directory, "1.json"), "utf8")).response.bodyState, "omitted-limit")
      assert.equal(calls.length, 1)
    })
  }
})

async function recording(run, fetch, options) {
  const root = await mkdtemp(join(tmpdir(), "opencode-http-record-test-"))
  const host = { fetch }
  try {
    const directory = await installRecorder(host, root, options)
    await run(host, async (id = 1) => JSON.parse(await readFile(join(directory, `${id}.json`), "utf8")), directory)
  } finally { await rm(root, { recursive: true }) }
}

test("record preserves request arguments and JSON response, redacts request copies only", async () => {
  const key = "sk-fictional-request-response-only"
  const input = "https://provider.test/v1/chat/completions"
  const init = { method: "POST", headers: { authorization: `Bearer ${key}`, "x-api-key": key }, body: JSON.stringify({ messages: [{ content: key }], api_key: key }) }
  const body = { token: key, answer: `Bearer ${key}`, api_key: key, nested: { url: "https://fixture.test/result", privateKey: "fictional-only" } }
  await recording(async (host, artifact, directory) => {
    const response = await host.fetch(input, init)
    assert.equal(response.status, 201)
    assert.equal(response.headers.get("set-cookie"), `fixture=${key}`)
    assert.equal(response.headers.get("x-api-key"), key)
    assert.equal(response.statusText, key)
    assert.deepEqual(await response.json(), body)
    const data = await artifact()
    assert.equal(data.blocked, false)
    assert.equal(data.state, "complete")
    assert.equal(data.request.body.api_key, "[REDACTED]")
    assert.equal(data.request.headers.authorization, "[REDACTED]")
    assert.equal(data.request.headers["x-api-key"], "[REDACTED]")
    assert.equal(data.request.body.messages[0].content, "[REDACTED]")
    assert.ok(!JSON.stringify(data.request).includes(key))
    assert.equal(data.response.headers["set-cookie"], "[REDACTED]")
    assert.equal(data.response.headers["x-api-key"], "[REDACTED]")
    assert.equal(data.response.statusText, "[REDACTED]")
    assert.equal(data.response.bodyState, "complete")
    assert.deepEqual(data.response.body, body)
    assert.equal((await stat(join(directory, "1.json"))).mode & 0o777, 0o600)
  }, async (actualInput, actual) => {
    assert.equal(actualInput, input)
    assert.equal(actual, init)
    assert.equal(actual.headers.authorization, `Bearer ${key}`)
    assert.equal(JSON.parse(actual.body).api_key, key)
    return Response.json(body, { status: 201, statusText: key, headers: { "set-cookie": `fixture=${key}`, "x-api-key": key } })
  })
})

test("SSE chunks pass through before completion and are recorded as raw UTF-8 text", async () => {
  let controller
  const encoder = new TextEncoder()
  const parts = ['data: {"token":"sk-', 'fictional-only","text":"你好"}\n\n', 'data: [DONE]\n\n']
  await recording(async (host, artifact) => {
    const response = await host.fetch("https://provider.test/responses")
    const reader = response.body.getReader()
    for (const part of parts) {
      controller.enqueue(encoder.encode(part))
      assert.equal(new TextDecoder().decode((await reader.read()).value), part)
    }
    assert.equal((await artifact()).state, "streaming")
    controller.close()
    assert.equal((await reader.read()).done, true)
    const data = await artifact()
    assert.equal(data.response.body, parts.join(""))
    assert.equal(data.response.bodyState, "complete")
  }, async () => new Response(new ReadableStream({ start(c) { controller = c } }), { headers: { "content-type": "text/event-stream" } }))
})

test("SSE and text preserve credentials, URLs and UTF-8 across arbitrary chunk boundaries", async () => {
  const key = "sk-fictional-stream-only"
  for (const type of ["text/event-stream; charset=utf-8", "text/plain; charset=utf-8"]) {
    const text = `\uFEFF: 你好😀\r\ndata: {"api_key":"${key}","url":"https://fixture.test/result"}\r\n\r\ndata: [DONE]\n\nBearer ${key}\n`
    const bytes = new TextEncoder().encode(text)
    for (const chunkSize of [1, 7, bytes.length]) {
      let offset = 0
      const init = { method: "POST", headers: { "x-api-key": key }, body: JSON.stringify({ messages: [], api_key: key }) }
      await recording(async (host, artifact) => {
        const response = await host.fetch("https://provider.test/messages", init)
        assert.equal(response.headers.get("x-api-key"), key)
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes)
        const data = await artifact()
        assert.equal(data.request.headers["x-api-key"], "[REDACTED]")
        assert.equal(data.request.body.api_key, "[REDACTED]")
        assert.equal(data.response.headers["x-api-key"], "[REDACTED]")
        assert.equal(data.response.bodyState, "complete")
        assert.equal(data.response.body, text)
        assert.equal(data.response.observedBytes, bytes.length)
      }, async (_, actual) => {
        assert.equal(actual, init)
        return new Response(new ReadableStream({ pull(controller) {
          if (offset === bytes.length) { controller.close(); return }
          const end = Math.min(bytes.length, offset + chunkSize)
          controller.enqueue(bytes.subarray(offset, end))
          offset = end
        } }, { highWaterMark: 0 }), { headers: { "content-type": type, "x-api-key": key } })
      }, { maxBytes: bytes.length })
    }
  }
})

test("tiny and zero-length chunks use bounded allocations, not retained fragment objects", async () => {
  const text = JSON.stringify({ text: "a".repeat(5000) })
  let index = 0, slices = 0, allocations = []
  await recording(async (host, artifact) => {
    const response = await host.fetch("https://provider.test/messages")
    const slice = Uint8Array.prototype.slice, alloc = Buffer.alloc
    try {
      Uint8Array.prototype.slice = function (...args) { slices++; return slice.apply(this, args) }
      Buffer.alloc = function (size, ...args) { allocations.push(size); return alloc.call(this, size, ...args) }
      assert.equal(await response.text(), text)
    } finally { Uint8Array.prototype.slice = slice; Buffer.alloc = alloc }
    assert.equal(slices, 0)
    assert.deepEqual(allocations, [4096, 8192])
    assert.equal((await artifact()).response.observedBytes, text.length)
    assert.equal((await artifact()).response.body.text.length, 5000)
  }, async () => new Response(new ReadableStream({ pull(controller) {
    if (index === text.length * 2) { controller.close(); return }
    controller.enqueue(index % 2 ? new Uint8Array([text.charCodeAt(Math.floor(index / 2))]) : new Uint8Array(0))
    index++
  } }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } }), { maxBytes: 8192 })
})

test("model scope skips other requests; all scope records binary metadata", async () => {
  await recording(async (host, artifact) => {
    assert.equal(await (await host.fetch("https://example.test/mcp")).text(), "binary")
    await assert.rejects(artifact(), { code: "ENOENT" })
  }, async () => new Response("binary"))
  await recording(async (host, artifact) => {
    assert.equal(await (await host.fetch("https://example.test/mcp")).text(), "binary")
    assert.equal((await artifact()).response.bodyState, "omitted-unsupported")
    assert.equal((await artifact()).response.body, undefined)
  }, async () => new Response("binary", { headers: { "content-type": "application/octet-stream" } }), { scope: "all" })
})

test("body limits omit content without truncating traffic", async () => {
  await recording(async (host, artifact) => {
    const response = await host.fetch("https://provider.test/messages", { method: "POST", body: '{"messages":[]}' })
    assert.equal(await response.text(), '{"answer":"long"}')
    const data = await artifact()
    assert.equal(data.request.bodyState, "omitted-limit")
    assert.equal(data.response.bodyState, "omitted-limit")
    assert.equal(data.response.body, undefined)
  }, async () => Response.json({ answer: "long" }), { maxBytes: 4 })
})

test("SSE and text over the limit or interrupted omit the entire body", async () => {
  const bytes = new TextEncoder().encode("data: sk-fictional-only\n\n")
  for (const type of ["text/event-stream", "text/plain"]) {
    await recording(async (host, artifact) => {
      assert.deepEqual(new Uint8Array(await (await host.fetch("https://provider.test/messages")).arrayBuffer()), bytes)
      const data = await artifact()
      assert.equal(data.state, "complete")
      assert.equal(data.response.bodyState, "omitted-limit")
      assert.equal(data.response.body, undefined)
    }, async () => new Response(bytes, { headers: { "content-type": type } }), { maxBytes: bytes.length - 1 })
    for (const state of ["cancelled", "stream-error"]) {
      let controller, reason
      const error = new Error("fictional stream failure")
      await recording(async (host, artifact) => {
        const reader = (await host.fetch("https://provider.test/messages")).body.getReader()
        assert.deepEqual((await reader.read()).value, bytes)
        if (state === "cancelled") {
          await reader.cancel("fixture-stop")
          assert.equal(reason, "fixture-stop")
        } else {
          controller.error(error)
          await assert.rejects(reader.read(), (actual) => actual === error)
        }
        const data = await artifact()
        assert.equal(data.state, state)
        assert.equal(data.response.bodyState, "omitted-incomplete")
        assert.equal(data.response.body, undefined)
        assert.equal(data.response.observedBytes, bytes.length)
      }, async () => new Response(new ReadableStream({
        start(c) { controller = c; c.enqueue(bytes) },
        cancel(value) { reason = value },
      }), { headers: { "content-type": type } }))
    }
  }
})

test("response bodyState distinguishes empty text, invalid JSON and unsupported content", async () => {
  for (const [type, bytes, state, body] of [
    ["text/plain", new Uint8Array(), "complete", ""],
    ["text/event-stream", new Uint8Array(), "complete", ""],
    ["text/plain", new Uint8Array([255]), "complete", "\uFFFD"],
    ["application/json", new TextEncoder().encode('"sk-fictional-json-scalar"'), "complete", "sk-fictional-json-scalar"],
    ["application/json", new TextEncoder().encode("null"), "complete", null],
    ["application/json", new TextEncoder().encode("not json"), "omitted-unparseable", undefined],
    ["application/octet-stream", new Uint8Array([0, 255, 1]), "omitted-unsupported", undefined],
    [undefined, new TextEncoder().encode("unknown"), "omitted-unsupported", undefined],
  ]) {
    await recording(async (host, artifact) => {
      assert.deepEqual(new Uint8Array(await (await host.fetch("https://provider.test/messages")).arrayBuffer()), bytes)
      const data = await artifact()
      assert.equal(data.state, "complete")
      assert.equal(data.response.bodyState, state)
      assert.equal(data.response.body, body)
    }, async () => new Response(bytes, { headers: type ? { "content-type": type } : {} }))
  }
})

test("network errors preserve identity and are recorded without raw error messages", async () => {
  const error = new Error("sensitive-fixture")
  await recording(async (host, artifact) => {
    await assert.rejects(host.fetch("https://provider.test/messages"), (actual) => actual === error)
    assert.equal((await artifact()).state, "network-error")
    assert.ok(!JSON.stringify(await artifact()).includes("sensitive-fixture"))
  }, async () => { throw error })
})

test("cancellation propagates and partial body is omitted", async () => {
  let reason
  await recording(async (host, artifact) => {
    const response = await host.fetch("https://provider.test/messages")
    await response.body.cancel("stop")
    assert.equal(reason, "stop")
    assert.equal((await artifact()).state, "cancelled")
    assert.equal((await artifact()).response.bodyState, "omitted-incomplete")
  }, async () => new Response(new ReadableStream({ cancel(value) { reason = value } })))
})

test("stream errors propagate and omit partial content", async () => {
  const error = new Error("stream fixture")
  await recording(async (host, artifact) => {
    const response = await host.fetch("https://provider.test/messages")
    await assert.rejects(response.text(), (actual) => actual === error)
    assert.equal((await artifact()).state, "stream-error")
  }, async () => new Response(new ReadableStream({ pull(c) { c.error(error) } })))
})

test("write failure and unavailable directory do not block traffic", async () => {
  await recording(async (host, artifact, directory) => {
    await rm(directory, { recursive: true })
    assert.equal(await (await host.fetch("https://provider.test/messages")).text(), "ok")
  }, async () => new Response("ok"))
  const root = await mkdtemp(join(tmpdir(), "opencode-http-missing-"))
  try {
    const original = async () => new Response("ok")
    const host = { fetch: original }
    assert.equal(await installRecorder(host, join(root, "absent")), undefined)
    assert.equal(host.fetch, original)
  } finally { await rm(root, { recursive: true }) }
})

test("Request bodies are not consumed by recording and bodyless responses pass through", async () => {
  const request = new Request("https://provider.test/messages", { method: "POST", body: '{"messages":[]}' })
  await recording(async (host, artifact) => {
    assert.equal((await host.fetch(request)).status, 204)
    assert.equal((await artifact()).request.bodyState, "omitted-stream-or-unsupported")
    assert.equal((await artifact()).response.bodyState, "empty")
  }, async (actual) => {
    assert.equal(actual, request)
    assert.equal(await actual.text(), '{"messages":[]}')
    return new Response(null, { status: 204 })
  })
})

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
