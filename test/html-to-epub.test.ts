import { readFileSync } from "fs";
import { resolve } from "path";
// import { fileURLToPath } from "url";

import { EPub } from "../src/html-to-epub";
import type { EpubOptions } from "../src/html-to-epub.types";

// const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function runTestOn(input: string): Promise<boolean> {
  const params = JSON.parse(
    readFileSync(resolve(__dirname, `./${input}.json`), { encoding: "utf8" })
  ) as EpubOptions;
  const output = resolve(__dirname, `./${input}.epub`);

  const epub = new EPub(params, output);
  const op = await epub.render();
  return op.result === "ok";
}

describe("html-to-epub", () => {
  describe("Generate", () => {
    it("Ebook > generate v2", async () => {
      expect(await runTestOn("book-v2")).toStrictEqual(true);
    });

    it("Ebook > generate v3", async () => {
      expect(await runTestOn("book-v3")).toStrictEqual(true);
    });

    it("HTML Page > generate v2", async () => {
      expect(await runTestOn("article-v2")).toStrictEqual(true);
    });

    it("HTML Page > generate v3", async () => {
      expect(await runTestOn("article-v3")).toStrictEqual(true);
    });
  });
});
