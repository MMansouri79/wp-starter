import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const lockName = "server-running.lock";
export async function assertServerStopped(dataDir: string): Promise<void> {
  const lock = path.join(dataDir, lockName);
  let pid: number;
  try { pid = Number(await readFile(lock, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid server lock. Verify the server is stopped before removing server-running.lock.");
  try { process.kill(pid, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") { await unlink(lock); return; }
    throw error;
  }
  throw new Error("The server is running. Stop it before migration or starting another instance.");
}
export async function acquireServerLock(dataDir: string): Promise<() => Promise<void>> {
  await mkdir(dataDir, { recursive: true });
  await assertServerStopped(dataDir);
  const lock = path.join(dataDir, lockName);
  await writeFile(lock, String(process.pid), { flag: "wx" });
  return async () => { await unlink(lock); };
}
