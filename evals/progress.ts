import { randomUUID } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** The caller serializes and awaits writes. This does not resume native work. */
export async function writeProgress(path: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) throw new TypeError("Progress must have a JSON representation.");
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let file: FileHandle | undefined;
  let created = false;
  try {
    file = await fs.open(temporary, "wx", 0o600);
    created = true;
    await file.writeFile(json + "\n", "utf8");
    await file.sync();
    await file.close();
    file = undefined;
    await fs.rename(temporary, path);
  } catch (error) {
    try { await file?.close(); } catch { /* Preserve the original write error. */ }
    if (created) try { await fs.unlink(temporary); } catch { /* Clean only this writer's temp; preserve the original error. */ }
    throw error;
  }
}
