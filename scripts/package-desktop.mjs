import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createZip } from "../packages/builder-core/dist/archive.js";

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), "..");
const outputDir = path.join(repoRoot, "artifacts", "desktop");
const unpackedDir = path.join(outputDir, "win-unpacked");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const portableZip = path.join(outputDir, `wp-starter-builder-v${packageJson.version}-portable.zip`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

await mkdir(outputDir, { recursive: true });
await rm(unpackedDir, { recursive: true, force: true });
await rm(portableZip, { force: true });

await run(process.execPath, [path.join(repoRoot, "scripts", "create-desktop-icon.mjs")]);
const electronBuilderCli = path.join(repoRoot, "node_modules", "electron-builder", "cli.js");
await run(process.execPath, [electronBuilderCli, "--win", "nsis", "dir", "--publish", "never"]);

const asar = path.join(unpackedDir, "resources", "app.asar");
for (const required of [
  asar,
  path.join(unpackedDir, "WP Starter Builder.exe")
]) {
  await access(required);
}

const asarCli = path.join(repoRoot, "node_modules", "@electron", "asar", "bin", "asar.js");
const listing = spawnSync(process.execPath, [asarCli, "list", asar], { encoding: "utf8" });
if (listing.status !== 0) throw new Error(`Unable to inspect ${asar}: ${listing.stderr || "asar inspection failed."}`);
const packagedFiles = new Set(listing.stdout.split(/\r?\n/).map((entry) => entry.replaceAll("\\", "/").replace(/^\/+/, "")));
for (const required of [
  "apps/desktop/main.mjs",
  "apps/gui/index.mjs",
  "apps/gui/public/index.html",
  "packages/builder-core/dist/index.js",
  "compatibility/known-good.json",
  "wordpress/bootstrap/site-starter-bootstrap.php"
]) {
  if (!packagedFiles.has(required)) throw new Error(`Desktop app.asar is missing ${required}.`);
}

await createZip(unpackedDir, portableZip);
const portableStats = await stat(portableZip);
if (portableStats.size === 0) throw new Error("Portable desktop ZIP is empty.");
console.log(`Installer and portable desktop package written to ${outputDir}`);
