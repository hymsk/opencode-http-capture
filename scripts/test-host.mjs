import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) { Object.assign(error, { stdout, stderr }); reject(error) }
      else resolve({ stdout, stderr })
    })
    // Non-interactive OpenCode reads piped stdin until EOF before running.
    child.stdin.end()
  })
}
const root = fileURLToPath(new URL("../", import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), "capture-host-test-"))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const opencode = process.env.OPENCODE_BIN || "opencode"
let calls = 0
const server = createServer(async (request, response) => {
  // A loopback-only fictional provider, never an actual model service.
  for await (const chunk of request) { /* Drain the test request. */ }
  calls++
  response.writeHead(200, { "content-type": "text/event-stream" })
  const chunk = (delta, finish_reason = null) => JSON.stringify({
    id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1,
    model: "fixture", choices: [{ index: 0, delta, finish_reason }],
  })
  response.write(`data: ${chunk({ role: "assistant", content: "HOST_SMOKE_OK" })}\n\n`)
  response.end(`data: ${chunk({}, "stop")}\n\ndata: [DONE]\n\n`)
})

try {
  const { stdout: version } = await execute(opencode, ["--version"], { timeout: 15_000 })
  console.log(`Host: OpenCode ${version.trim()}`)
  const { stdout } = await execute(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], { cwd: root })
  const [packed] = JSON.parse(stdout)
  await writeFile(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }))
  await execute(npm, ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false",
    "--cache", join(temporary, "npm-cache"), join(temporary, packed.filename)], { cwd: temporary, timeout: 30_000 })
  const dependencies = join(temporary, "host-dependencies")
  await mkdir(dependencies)
  await writeFile(join(dependencies, "package.json"), JSON.stringify({ private: true }))
  console.log("Preparing isolated host dependencies (prefer cached packages)")
  const installArgs = ["install", "--ignore-scripts", "--no-audit", "--no-fund", `@opencode-ai/plugin@${version.trim()}`]
  try {
    await execute(npm, [...installArgs, "--offline"], { cwd: dependencies, timeout: 30_000 })
  } catch {
    await execute(npm, [...installArgs, "--registry=https://registry.npmjs.org/", "--fetch-retries=1", "--fetch-timeout=15000"], { cwd: dependencies, timeout: 60_000 })
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`
  for (const mode of ["block", "record", "all"]) {
    const home = join(temporary, mode)
    const captures = join(home, "captures")
    await mkdir(captures, { recursive: true })
    const configDirectory = join(home, "config/opencode")
    await cp(dependencies, configDirectory, { recursive: true })
    const config = {
      $schema: "https://opencode.ai/config.json",
      plugin: [pathToFileURL(join(temporary, "node_modules/opencode-http-capture/dist/entry.js")).href],
      enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture",
      provider: { fixture: {
        npm: "@ai-sdk/openai-compatible", name: "Loopback test provider",
        options: { baseURL, apiKey: "fictional-test-key" },
        models: { fixture: { name: "Fixture", limit: { context: 8192, output: 1024 } } },
      } },
      permission: { "*": "deny" }, share: "disabled", autoupdate: false,
    }
    // Do not inherit credentials, proxy settings, user config or live Sessions.
    const env = {
      PATH: process.env.PATH, HOME: home,
      XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"),
      XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "1", OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
      OPENCODE_CAPTURE: mode, OPENCODE_CAPTURE_DIR: captures,
    }
    const before = calls
    const result = await execute(opencode, ["run", "--print-logs", "--log-level", "DEBUG", "--dir", home, "--format", "json", "--model", "fixture/fixture", "Reply with HOST_SMOKE_OK. Do not use tools."], {
      cwd: home, env, timeout: 45_000, maxBuffer: 2 * 1024 * 1024,
    })
    assert.doesNotMatch(result.stdout, /"type":"error"/)
    const directories = await readdir(captures)
    assert.equal(directories.length, 1, `No capture directory for ${mode}: ${result.stderr}`)
    const directory = join(captures, directories[0])
    const files = await readdir(directory)
    assert.ok(files.length > 0, `No artifacts for ${mode}: ${result.stdout}`)
    const artifacts = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(directory, file), "utf8"))))
    const model = artifacts.filter((item) => item.request.body?.model === "fixture")
    assert.ok(model.length > 0, "Missing loopback model request")
    if (mode === "block") {
      assert.equal(calls, before, "Block mode forwarded a provider request")
      assert.ok(model.every((item) => item.blocked))
      assert.ok(result.stdout.includes(directory), "Capture path absent from host answer")
    } else {
      assert.ok(calls > before, "Record mode failed to forward to loopback provider")
      assert.ok(result.stdout.includes("HOST_SMOKE_OK"), "Host did not consume provider answer")
      for (const item of model) {
        assert.equal(item.state, "complete")
        assert.equal(item.response.bodyState, "complete")
        assert.ok(item.response.body.includes("HOST_SMOKE_OK"))
        assert.equal(item.request.headers.authorization, "[REDACTED]")
      }
    }
    console.log(`PASS ${mode}: ${model.length} model captures; ${calls - before} loopback provider calls`)
  }
} catch (error) {
  // Child output comes only from the isolated fixture, with fictional credentials.
  if (error.stdout) console.error(error.stdout)
  if (error.stderr) console.error(error.stderr)
  throw error
} finally {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
