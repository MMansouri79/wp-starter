import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "../packages/builder-core/dist/archive.js";

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const version = packageJson.version;
const artifacts = path.join(repoRoot, "artifacts");
const stageRoot = path.join(artifacts, ".exporter-stage");
const stage = path.join(stageRoot, "wp-starter-exporter");
const output = path.join(artifacts, `wp-starter-exporter-v${version}.zip`);

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(path.join(repoRoot, "wordpress/exporter"), stage, { recursive: true, force: true });
await writeFile(path.join(stage, "VERSION.txt"), `${version}\n`, "utf8");
await mkdir(artifacts, { recursive: true });
await createZip(stageRoot, output);
await rm(stageRoot, { recursive: true, force: true });
console.log(output);
