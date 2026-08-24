import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "../packages/builder-core/dist/archive.js";

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const version = packageJson.version;
const artifacts = path.join(repoRoot, "artifacts");
const stageRoot = path.join(artifacts, ".builder-stage");
const stage = path.join(stageRoot, "wp-starter-builder");
const output = path.join(artifacts, `wp-starter-builder-v${version}.zip`);

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const copy = async (source, destination) => {
  await cp(path.join(repoRoot, source), path.join(stage, destination), { recursive: true, force: true });
};

await copy("apps/cli/dist", "apps/cli/dist");
await copy("apps/cli/package.json", "apps/cli/package.json");
await copy("packages/builder-core/dist", "packages/builder-core/dist");
await copy("packages/builder-core/package.json", "packages/builder-core/package.json");
await copy("profiles", "profiles");
await copy("wordpress/bootstrap", "wordpress/bootstrap");
await copy("scripts/build.cmd", "scripts/build.cmd");
await copy("scripts/build.ps1", "scripts/build.ps1");
await copy("scripts/wp-starter.cmd", "scripts/wp-starter.cmd");
await copy("scripts/wp-starter.ps1", "scripts/wp-starter.ps1");
await copy("README.md", "README.md");
await copy("docs/PHASE-1.md", "PHASE-1.md");
await copy("docs/PACKAGE-FORMAT.md", "PACKAGE-FORMAT.md");

await writeFile(path.join(stage, "VERSION.txt"), `${version}\n`, "utf8");
await mkdir(artifacts, { recursive: true });
await createZip(stageRoot, output);
await rm(stageRoot, { recursive: true, force: true });

console.log(output);
