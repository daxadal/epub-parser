import path from "node:path";
// import { readFileSync } from "node:fs";

import oldLibrary from "epub-parser";
// import { EPub as OldEPub } from "@lesjoursfr/html-to-epub";

import { open as newOpen } from "../src/epub-parser";
// import { EPub as NewEPub } from "../src/html-to-epub";

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
      const newEpub = await newOpen(EPUB_PATH);

      expect(newEpub).toEqual(oldEpub);
    });
  });

  /*
  describe("@lesjoursfr/html-to-epub", () => {
    it.each`
      name                | file
      ${"Ebook (v2)"}     | ${"book-v2"}
      ${"Ebook (v3)"}     | ${"book-v3"}
      ${"HTML Page (v2)"} | ${"article-v2"}
      ${"HTML Page (v3)"} | ${"article-v3"}
    `(
      "The library returns the same output as the original > $name",
      async ({ file }) => {
        const epubOptions = JSON.parse(
          readFileSync(path.resolve(__dirname, `./${file}.json`), {
            encoding: "utf8",
          })
        );

        const oldOutput = path.resolve(__dirname, `./${file}-old.epub`);
        const newOutput = path.resolve(__dirname, `./${file}-new.epub`);

        await new OldEPub(epubOptions, oldOutput).render();
        await new NewEPub(epubOptions, newOutput).render();

        const oldEpub = readFileSync(oldOutput, { encoding: "utf8" });
        const newEpub = readFileSync(newOutput, { encoding: "utf8" });

        expect(newEpub).toEqual(oldEpub);
      }
    );
  });
  */
});
