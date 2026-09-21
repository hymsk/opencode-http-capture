import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

test("npm tarball contains only release assets and loads by package name offline", { timeout: 120_000 }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "capture-package-test-"))
  const options = { cwd: root, encoding: "utf8", timeout: 45_000 }
  try {
    // npm test builds first. Skip prepack here to avoid testing lifecycle hooks
    // recursively; the final release check also runs normal npm pack.
    const [packed] = JSON.parse(execFileSync(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], options))
    assert.equal(packed.name, manifest.name)
    assert.equal(packed.version, manifest.version)
    assert.deepEqual(packed.files.map(({ path }) => path).sort(), [
      "CHANGELOG.md", "LICENSE", "README.md", "README.zh-cn.md", "RELEASING.md", "SPEC.md",
      "dist/entry.js", "dist/plugin.js", "dist/record.js", "package.json",
    ].sort())
    assert.equal(manifest.main, "./dist/entry.js")
    assert.equal(manifest.exports["."], manifest.main)
    assert.equal(manifest.dependencies, undefined)
    assert.equal(manifest.peerDependencies, undefined)

    await writeFile(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }))
    execFileSync(npm, ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false",
      "--cache", join(temporary, "npm-cache"), join(temporary, packed.filename)], { ...options, cwd: temporary })

    for (const mode of ["", "block", "record", "all", "invalid"]) {
      await t.test(`installed entry: ${mode || "disabled"}`, () => {
        execFileSync(process.execPath, ["--input-type=module", "-e", `
          import assert from "node:assert/strict";
          import { readFile, readdir } from "node:fs/promises";
          import { join } from "node:path";
          const calls = [];
          const original = async (...args) => { calls.push(args); return Response.json({ ok: true }); };
          globalThis.fetch = original;
          const plugin = await import("opencode-http-capture");
          assert.deepEqual(Object.keys(plugin), ["default"]);
          assert.equal(typeof plugin.default, "function");
          assert.equal(globalThis.fetch, original);
          const mode = process.env.OPENCODE_CAPTURE;
          if (mode === "invalid") {
            await assert.rejects(plugin.default(), /Invalid OPENCODE_CAPTURE/);
            assert.equal(globalThis.fetch, original);
          } else {
            assert.deepEqual(await plugin.default(), {});
            if (!mode) {
              assert.equal(globalThis.fetch, original);
            } else {
              const wrapper = globalThis.fetch;
              await plugin.default();
              assert.equal(globalThis.fetch, wrapper);
              const response = await globalThis.fetch("https://provider.test/v1/chat/completions", {
                method: "POST", body: '{"messages":[]}'
              });
              const body = await response.json();
              assert.equal(calls.length, mode === "block" ? 0 : 1);
              const directories = (await readdir(process.env.OPENCODE_CAPTURE_DIR)).filter((name) => name.startsWith("opencode-http-capture-"));
              assert.equal(directories.length, 1);
              const directory = join(process.env.OPENCODE_CAPTURE_DIR, directories[0]);
              const artifact = JSON.parse(await readFile(join(directory, "1.json"), "utf8"));
              assert.equal(artifact.blocked, mode === "block");
              if (mode === "block") assert.equal(body.choices[0].message.content, join(directory, "1.json"));
              else { assert.deepEqual(body, { ok: true }); assert.deepEqual(artifact.response.body, body); }
              await (await globalThis.fetch("https://fixture.test/mcp")).json();
              assert.equal(calls.length, mode === "block" ? 1 : 2);
              assert.equal((await readdir(directory)).length, mode === "all" ? 2 : 1);
            }
          }
        `], {
          ...options, cwd: temporary,
          env: { ...process.env, OPENCODE_CAPTURE: mode, OPENCODE_CAPTURE_MODE: "invalid",
            OPENCODE_CAPTURE_SCOPE: "invalid", OPENCODE_CAPTURE_MAX_BYTES: "1048576", OPENCODE_CAPTURE_DIR: temporary },
        })
        // Each process has a fresh installation marker and capture directory.
        // Remove only this test's generated captures before the next mode.
      })
      for (const name of await readdir(temporary)) {
        if (name.startsWith("opencode-http-capture-")) await rm(join(temporary, name), { recursive: true, force: true })
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
