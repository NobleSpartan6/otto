import { createWorker, PSM, type Worker } from "tesseract.js";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { NativeControl, NativeSnapshot } from "../shared/types.js";

const require = createRequire(import.meta.url);
const workerAsset = (path: string) => path.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
export class LocalOCR {
  private worker?: Promise<Worker>;
  private getWorker() {
    if (!this.worker)
      this.worker = createWorker("eng", 1, {
        workerPath:
          workerAsset(require.resolve("tesseract.js/src/worker-script/node/index.js")),
        corePath: workerAsset(dirname(require.resolve("tesseract.js-core/package.json"))),
        langPath: workerAsset(join(
          dirname(require.resolve("@tesseract.js-data/eng/package.json")),
          "4.0.0_best_int",
        )),
        cacheMethod: "none",
        gzip: true,
        logger: () => undefined,
      }).then(async (worker) => {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        return worker;
      });
    return this.worker;
  }
  async controls(snapshot: NativeSnapshot): Promise<NativeControl[]> {
    if (
      !snapshot.screenshot ||
      !snapshot.screenshotSize ||
      !snapshot.windowBounds
    )
      return [];
    const worker = await this.getWorker();
    const { data } = await worker.recognize(
      snapshot.screenshot,
      {},
      { blocks: true, text: true },
    );
    const { windowBounds: b, screenshotSize: s } = snapshot;
    const result: NativeControl[] = [];
    for (const block of data.blocks ?? [])
      for (const paragraph of block.paragraphs)
        for (const line of paragraph.lines) {
          const label = line.text.trim().replace(/\s+/g, " ");
          if (
            line.confidence < 70 ||
            label.length < 2 ||
            label.length > 180 ||
            result.length >= 50
          )
            continue;
          const rect = {
            x: b.x + (line.bbox.x0 / s.width) * b.width,
            y: b.y + (line.bbox.y0 / s.height) * b.height,
            width: ((line.bbox.x1 - line.bbox.x0) / s.width) * b.width,
            height: ((line.bbox.y1 - line.bbox.y0) / s.height) * b.height,
          };
          const cx = rect.x + rect.width / 2,
            cy = rect.y + rect.height / 2;
          if (
            snapshot.protectedBounds?.some(
              (p) =>
                rect.x < p.x + p.width &&
                rect.x + rect.width > p.x &&
                rect.y < p.y + p.height &&
                rect.y + rect.height > p.y,
            )
          )
            continue;
          const covered = snapshot.controls.some(
            (c) =>
              c.bounds &&
              cx >= c.bounds.x &&
              cy >= c.bounds.y &&
              cx <= c.bounds.x + c.bounds.width &&
              cy <= c.bounds.y + c.bounds.height &&
              c.actions.includes("press"),
          );
          if (covered) continue;
          result.push({
            id: `ocr-${result.length}`,
            role: "OCRText",
            label,
            enabled: true,
            actions: ["press"],
            editable: false,
            source: "ocr",
            bounds: rect,
          });
        }
    return result;
  }
  async close() {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) await worker.then((w) => w.terminate()).catch(() => undefined);
  }
}
