import { installCapture } from "./plugin.ts"
export default async function () {
  if (!["1", "true"].includes(process.env.OPENCODE_CAPTURE ?? "")) return {}
  const key = Symbol.for("opencode-http-capture.installed")
  const host = globalThis as any
  if (host[key]) return {}
  host[key] = true
  await installCapture(host, process.env.OPENCODE_CAPTURE_DIR)
  return {}
}
