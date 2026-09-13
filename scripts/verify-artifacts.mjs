import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractZip } from "../packages/builder-core/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const artifacts = path.join(root, "artifacts");
const names = [
  `wp-starter-builder-v${packageJson.version}.zip`,
  `wp-starter-exporter-v${(await readFile(path.join(root, "wordpress/exporter/VERSION.txt"), "utf8")).trim()}.zip`
];

async function files(dir, prefix = "") {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await files(path.join(dir, entry.name), name));
    else output.push(name);
  }
  return output;
}

for (const name of names) {
  const archive = path.join(artifacts, name);
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-artifact-"));
  try {
    await extractZip(archive, temp);
    const entries = await files(temp);
    const hasEntry = (relative) => entries.includes(relative) || entries.some((entry) => entry.endsWith(`/${relative}`));
    const forbidden = entries.filter((entry) => /(^|\/)(node_modules|\.git|private-packages)(\/|$)|\.local\.json$/i.test(entry));
    if (forbidden.length) throw new Error(`${name} contains forbidden entries: ${forbidden.join(", ")}`);
    if (name.includes("builder") && !hasEntry("wordpress/bootstrap/site-starter-bootstrap.php")) throw new Error("Builder artifact is missing the bootstrap runtime.");
    if (name.includes("exporter") && !hasEntry("starter-exporter.php")) throw new Error("Exporter artifact is missing the plugin entrypoint.");
    console.log(`Verified ${name} (${entries.length} files).`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
