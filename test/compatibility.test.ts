import path from "node:path";

import oldLibrary from "epub-parser";

import { open as newOpen } from "../src/epub-parser";

const EPUB_PATH = path.join(__dirname, "testbook.epub");

const promisify =
  (fn: any) =>
  (...args: any) =>
    new Promise((resolve, reject) =>
      fn(...args, (err: any, result: any) =>
        err ? reject(err) : resolve(result)
      )
    );

const oldOpen = promisify(oldLibrary.open);

describe("Compatibility", () => {
  describe("epub-parser", () => {
    test("The library returns the same output as the original", async () => {
      const oldEpub = await oldOpen(EPUB_PATH);
      const newEpub = await newOpen(EPUB_PATH, { mode: "legacy" });

      expect(newEpub).toEqual(oldEpub);
    });
  });
});
