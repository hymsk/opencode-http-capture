import { mkdtemp, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
const secret = /^(authorization|proxy-authorization|.*api[-_]?key|.*private[-_]?key|.*secret[-_]?access[-_]?key|.*token|.*secret|password|cookie|set-cookie)$/i
export function redact(value: unknown, key = ""): unknown {
  if (secret.test(key)) return "[REDACTED]"
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]))
  if (typeof value === "string") return value.replace(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g, "[REDACTED]").replace(/https?:\/\/[^\s<>"'`]+/gi, "[URL_REDACTED]").replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]").replace(/\b(?:sk-[\w-]+|ghp_[\w]+|github_pat_[\w]+)\b/g, "[REDACTED]")
  return value
}
export function pathResponse(body: Record<string, any>, file: string, pathname: string): Response {
  if (!pathname.endsWith("/chat/completions")) return Response.json({ error: { message: `Captured request: ${file}` } }, { status: 400 })
  const base = { id: "capture", created: Math.floor(Date.now() / 1000), model: body.model ?? "capture" }
  if (!body.stream) return Response.json({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: file }, finish_reason: "stop" }] })
  const chunks = [{ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: file }, finish_reason: null }] }, { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
}
export async function installCapture(host: { fetch: typeof fetch }, baseDir = tmpdir()) {
  const originalFetch = host.fetch.bind(host), directory = await mkdtemp(join(resolve(baseDir), "opencode-http-capture-"))
  let counter = 0
  host.fetch = async (input, init) => {
    const req = new Request(input, init), pathname = new URL(req.url).pathname
    let body: Record<string, any> | undefined
    if (!["GET", "HEAD"].includes(req.method)) try { body = JSON.parse(await req.clone().text()) } catch {}
    const modelEndpoint = /\/(chat\/completions|responses|messages)(?:\/|$)|:streamGenerateContent|:generateContent/.test(pathname)
    const modelBody = body && (Array.isArray(body.messages) || Array.isArray(body.contents) || "input" in body)
    if (!modelEndpoint && !modelBody) return originalFetch(input, init)
    if (!body) throw new Error("Capture blocked unreadable model request")
    const file = join(directory, `${++counter}.json`)
    await writeFile(file, JSON.stringify(redact({ capturedAt: new Date().toISOString(), blocked: true, request: { method: req.method, url: req.url, headers: Object.fromEntries(req.headers), body } }), null, 2) + "\n", { mode: 0o600, flag: "wx" })
    return pathResponse(body, file, pathname)
  }
  return directory
}
