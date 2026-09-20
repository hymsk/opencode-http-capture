import { installCapture } from "./plugin.ts"
import { installRecorder } from "./record.ts"
import { tmpdir } from "node:os"
export default async function () {
  const capture = process.env.OPENCODE_CAPTURE ?? ""
  if (["", "false", "0"].includes(capture)) return {}
  if (!["block", "record", "all", "1", "true"].includes(capture)) {
    throw new Error("Invalid OPENCODE_CAPTURE: expected block, record, all, 1, true, false, 0 or an empty value")
  }
  // Only legacy opt-ins read MODE/SCOPE. Named modes are self-contained.
  const legacy = capture === "1" || capture === "true"
  const mode = legacy ? process.env.OPENCODE_CAPTURE_MODE ?? "block" : capture === "block" ? "block" : "record"
  const scope = legacy ? process.env.OPENCODE_CAPTURE_SCOPE ?? "model" : capture === "all" ? "all" : "model"
  const key = Symbol.for("opencode-http-capture.installed")
  const host = globalThis as any
  if (host[key]) { await host[key]; return {} }
  // Publish the in-flight Promise before installation starts; failed attempts
  // clear only their own slot so later entry calls may retry.
  const installing = Promise.resolve().then(async () => {
    if (mode === "record") {
      if (scope !== "model" && scope !== "all") throw new Error("Invalid OPENCODE_CAPTURE_SCOPE")
      const directory = await installRecorder(host, process.env.OPENCODE_CAPTURE_DIR ?? tmpdir(), {
        scope, maxBytes: Number(process.env.OPENCODE_CAPTURE_MAX_BYTES ?? 1048576),
      })
      if (!directory) return false
      console.warn(`[opencode-http-capture] Recording to ${directory}`)
    } else if (mode === "block") {
      await installCapture(host, process.env.OPENCODE_CAPTURE_DIR)
    } else throw new Error("Invalid OPENCODE_CAPTURE_MODE")
    return true
  })
  host[key] = installing
  try {
    if (await installing) host[key] = true
    else if (host[key] === installing) delete host[key]
  } catch (error) {
    if (host[key] === installing) delete host[key]
    throw error
  }
  return {}
}
