import { spawn } from "node:child_process";
import path from "node:path";
import { BuilderError } from "./errors.js";
import { ensureDir } from "./fs-utils.js";

async function run(command: string, args: string[], cwd?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new BuilderError("archive_command_failed", `${command} exited with ${code}: ${stderr.trim()}`));
      }
    });
  });
}

function psQuote(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

export async function extractZip(zipPath: string, destination: string): Promise<void> {
  await ensureDir(destination);

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
      `$src=${psQuote(path.resolve(zipPath))};`,
      `$dst=${psQuote(path.resolve(destination))};`,
      "[System.IO.Compression.ZipFile]::ExtractToDirectory($src,$dst);"
    ].join(" ");

    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return;
  }

  await run("unzip", ["-q", path.resolve(zipPath), "-d", path.resolve(destination)]);
}

export async function createZip(sourceDir: string, destinationZip: string): Promise<void> {
  if (process.platform === "win32") {
    // ZipFile.CreateFromDirectory() on Windows can emit backslashes in entry
    // names. Linux unzip accepts them poorly and Plesk's filemng rejects the
    // archive. Create every entry explicitly and force the ZIP-standard `/`
    // separator so artifacts produced on Windows remain portable to Linux.
    const script = [
      "Add-Type -AssemblyName System.IO.Compression;",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
      `$src=${psQuote(path.resolve(sourceDir))};`,
      `$dst=${psQuote(path.resolve(destinationZip))};`,
      "if (Test-Path $dst) { Remove-Item -Force $dst };",
      "$root=[System.IO.Path]::GetFullPath($src);",
      "$archive=[System.IO.Compression.ZipFile]::Open($dst,[System.IO.Compression.ZipArchiveMode]::Create);",
      "try {",
      "Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {",
      "$relative=$_.FullName.Substring($root.Length).TrimStart([char]92,[char]47);",
      "$entryName=$relative.Replace([char]92,[char]47);",
      "[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$_.FullName,$entryName,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null;",
      "};",
      "} finally { $archive.Dispose(); }"
    ].join(" ");

    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return;
  }

  await run("zip", ["-qr", path.resolve(destinationZip), "."], path.resolve(sourceDir));
}
