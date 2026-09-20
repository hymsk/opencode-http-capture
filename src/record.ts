import { mkdtemp, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { types } from "node:util"
import { redact } from "./plugin.ts"

export type RecordOptions = { scope?: "model" | "all", maxBytes?: number }
const modelEndpoint = /\/(chat\/completions|responses|messages)(?:\/|$)|:streamGenerateContent|:generateContent/

// Inspect only ordinary data properties: invoking a getter/iterator here can
// change what the real fetch receives. Unsupported inputs bypass recording.
function dataProperties(value: any, array = false): PropertyDescriptorMap {
  if (!value || typeof value !== "object" || types.isProxy(value)) throw new Error("Unsafe snapshot")
  const proto = Object.getPrototypeOf(value)
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new Error("Unsafe snapshot")
  const properties = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(value).length || Object.values(properties).some((p) => !("value" in p))) throw new Error("Unsafe snapshot")
  return properties
}

function snapshotHeaders(value: any): Record<string, string> {
  if (value == null) return {}
  if (!types.isProxy(value) && Object.getPrototypeOf(value) === Headers.prototype) {
    return Object.fromEntries(Headers.prototype.entries.call(value))
  }
  const properties = dataProperties(value, Array.isArray(value))
  const copy: [string, string][] = []
  if (Array.isArray(value)) {
    for (let i = 0; i < properties.length.value; i++) {
      const pair = dataProperties(properties[i]?.value, true)
      if (pair.length.value !== 2 || typeof pair[0]?.value !== "string" || typeof pair[1]?.value !== "string") throw new Error("Unsafe snapshot")
      copy.push([pair[0].value, pair[1].value])
    }
  } else {
    for (const [key, property] of Object.entries(properties)) {
      if (!property.enumerable) continue
      if (typeof property.value !== "string") throw new Error("Unsafe snapshot")
      copy.push([key, property.value])
    }
  }
  return Object.fromEntries(new Headers(copy))
}

const nativeClone = Response.prototype.clone
function preserveMetadata(target: Response, metadata: { url: string, redirected: boolean, type: ResponseType }): Response {
  for (const key of ["url", "redirected", "type"] as const) Object.defineProperty(target, key, { value: metadata[key] })
  Object.defineProperty(target, "clone", { value: function (this: Response) {
    // Use the native tee/locking/cancellation implementation, including errors.
    return preserveMetadata(nativeClone.call(this), metadata)
  } })
  return target
}

export async function installRecorder(host: { fetch: typeof fetch }, baseDir: string, options: RecordOptions = {}) {
  const scope = options.scope ?? "model", maxBytes = options.maxBytes ?? 1024 * 1024
  if (!["model", "all"].includes(scope) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Invalid capture record options")
  }
  let warned = false
  const warn = () => {
    if (!warned) { warned = true; console.warn("[opencode-http-capture] Recording unavailable or incomplete; traffic continues.") }
  }
  let directory: string
  try { directory = await mkdtemp(join(resolve(baseDir), "opencode-http-capture-")) }
  catch { warn(); return undefined }
  const originalFetch = host.fetch.bind(host)
  let counter = 0
  host.fetch = async (input, init) => {
    let request: Record<string, any>, body: any, pathname: string
    try {
      const properties = init == null ? {} : dataProperties(init)
      if (typeof input !== "string" && (types.isProxy(input) || ![Request.prototype, URL.prototype].includes(Object.getPrototypeOf(input)))) throw new Error("Unsafe snapshot")
      const source = input instanceof Request ? input : undefined
      const url = source ? Object.getOwnPropertyDescriptor(Request.prototype, "url")!.get!.call(source) :
        typeof input === "string" ? input : Object.getOwnPropertyDescriptor(URL.prototype, "href")!.get!.call(input)
      pathname = new URL(url).pathname
      const raw = properties.body?.value
      let bodyState = "omitted-stream-or-unsupported"
      if (typeof raw === "string") {
        if (Buffer.byteLength(raw) > maxBytes) bodyState = "omitted-limit"
        else {
          try { body = JSON.parse(raw); bodyState = "complete" }
          catch { bodyState = "omitted-non-json" }
        }
      } else if (raw == null && !(source && Object.getOwnPropertyDescriptor(Request.prototype, "body")!.get!.call(source))) bodyState = "empty"
      const method = properties.method?.value ?? (source && Object.getOwnPropertyDescriptor(Request.prototype, "method")!.get!.call(source)) ?? "GET"
      if (typeof method !== "string") throw new Error("Unsafe snapshot")
      request = { method, url, headers: snapshotHeaders(properties.headers?.value ?? (source && Object.getOwnPropertyDescriptor(Request.prototype, "headers")!.get!.call(source))), body, bodyState }
    } catch { warn(); return originalFetch(input, init) }
    const modelBody = body && typeof body === "object" &&
      (Array.isArray(body.messages) || Array.isArray(body.contents) || "input" in body)
    if (scope !== "all" && !modelEndpoint.test(pathname) && !modelBody) return originalFetch(input, init)

    const id = ++counter, file = join(directory, `${id}.json`)
    const artifact: Record<string, any> = { id, mode: "record", blocked: false,
      capturedAt: new Date().toISOString(), request, state: "pending" }
    let writable = true, firstWrite = true
    const save = async () => {
      if (!writable) return
      try {
        // Redact request and response metadata only. Never traverse the response
        // body: record mode deliberately preserves provider output verbatim.
        const { response, ...metadata } = artifact
        const saved = redact(metadata) as Record<string, any>
        if (response) {
          const { body, ...responseMetadata } = response
          saved.response = { ...(redact(responseMetadata) as Record<string, any>), body }
        }
        await writeFile(file, JSON.stringify(saved, null, 2) + "\n",
          { mode: 0o600, flag: firstWrite ? "wx" : "w" })
        firstWrite = false
      } catch { writable = false; warn() }
    }
    await save()
    let response: Response
    try { response = await originalFetch(input, init) }
    catch (error) {
      artifact.state = "network-error"
      artifact.finishedAt = new Date().toISOString()
      await save()
      throw error
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      artifact.response = { status: response.status, statusText: response.statusText,
        headers: Object.fromEntries(response.headers), receivedAt: new Date().toISOString(), bodyState: "pending" }
      artifact.state = "streaming"
      await save()
      if (!response.body) {
        artifact.state = "complete"; artifact.response.bodyState = "empty"
        artifact.finishedAt = new Date().toISOString()
        await save()
        return response
      }
      if (response.bodyUsed || response.body.locked) throw new Error("Unavailable body")
      const type = response.headers.get("content-type") ?? ""
      const sse = /text\/event-stream/i.test(type)
      const json = !sse && /\bjson\b|\+json\b/i.test(type)
      const text = /^\s*text\//i.test(type)
      // One geometrically grown allocation, not one retained object per chunk.
      // Empty chunks allocate nothing; old + new allocation peaks below 3*maxBytes.
      let buffer: Buffer | undefined, bytes = 0, finished = false, captureFailed = false
      const finish = async (state: string) => {
        if (finished) return
        finished = true
        artifact.state = state
        artifact.finishedAt = new Date().toISOString()
        artifact.response.observedBytes = bytes
        artifact.response.bodyState = state !== "complete" ? "omitted-incomplete" : captureFailed ? "omitted-unavailable" : bytes > maxBytes ? "omitted-limit" : "omitted-unsupported"
        if (state === "complete" && !captureFailed && bytes <= maxBytes && (json || text)) {
          try {
            const raw = buffer?.toString("utf8", 0, bytes) ?? ""
            artifact.response.body = json ? JSON.parse(raw) : raw
            artifact.response.bodyState = "complete"
          } catch { artifact.response.bodyState = "omitted-unparseable" }
        }
        buffer = undefined
        await save()
      }
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader!.read()
            if (finished) return
            if (done) { await finish("complete"); controller.close(); return }
            const offset = bytes
            bytes = Math.min(Number.MAX_SAFE_INTEGER, bytes + value.byteLength)
            if (bytes > maxBytes) buffer = undefined
            else if (value.byteLength && (json || text) && !captureFailed) {
              try {
                if (!buffer || buffer.length < bytes) {
                  const next = Buffer.alloc(Math.min(maxBytes, Math.max(4096, bytes, (buffer?.length ?? 0) * 2)))
                  if (buffer) next.set(buffer.subarray(0, offset))
                  buffer = next
                }
                buffer.set(value, offset)
              } catch { captureFailed = true; buffer = undefined; warn() }
            }
            controller.enqueue(value)
          } catch (error) {
            if (finished) return
            await finish("stream-error"); controller.error(error)
          }
        },
        async cancel(reason) {
          const recording = finish("cancelled")
          try { await reader!.cancel(reason) } finally { await recording }
        },
      }, { highWaterMark: 0 })
      const wrapped = new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers })
      preserveMetadata(wrapped, { url: response.url, redirected: response.redirected, type: response.type })
      // No source read/lock until all potentially failing setup has succeeded.
      reader = response.body.getReader()
      return wrapped
    } catch {
      reader?.releaseLock()
      warn()
      artifact.state = "recording-unavailable"
      artifact.response = { ...artifact.response, bodyState: "omitted-unavailable" }
      artifact.finishedAt = new Date().toISOString()
      await save()
      return response
    }
  }
  return directory
}
