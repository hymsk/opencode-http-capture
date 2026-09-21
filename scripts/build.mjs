import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"

// Keep compilation dependency-free. Node strips erasable types; the emitted
// relative imports must point to JavaScript, not the development TypeScript.
const root = new URL("../", import.meta.url)
const output = new URL("dist/", root)
const modules = ["entry", "plugin", "record"]
const compiled = await Promise.all(modules.map(async (name) => {
  const source = await readFile(new URL(`src/${name}.ts`, root), "utf8")
  const code = stripTypeScriptTypes(source, { mode: "strip" })
    .replace(/(\bfrom\s+["']\.\/[^"']+)\.ts(["'])/g, "$1.js$2")
  return [name, code]
}))

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await Promise.all(compiled.map(([name, code]) => writeFile(new URL(`${name}.js`, output), code)))
console.log(`Built ${modules.length} ESM modules in dist/`)
