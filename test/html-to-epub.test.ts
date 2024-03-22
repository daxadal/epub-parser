import { readFileSync } from "fs";
import { resolve } from "path";
// import { fileURLToPath } from "url";

import { EPub } from "../src/html-to-epub";
import type { EpubOptions } from "../src/html-to-epub.types";

// const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("html-to-epub", () => {
  describe("Generate", () => {
    it.each`
      name                | file
      ${"Ebook (v2)"}     | ${"book-v2"}
      ${"Ebook (v3)"}     | ${"book-v3"}
      ${"HTML Page (v2)"} | ${"article-v2"}
      ${"HTML Page (v3)"} | ${"article-v3"}
    `("Succesfully generates a $name", async ({ file }) => {
      const params = JSON.parse(
        readFileSync(resolve(__dirname, `./${file}.json`), { encoding: "utf8" })
      ) as EpubOptions;
      const output = resolve(__dirname, `./${file}.epub`);

      const epub = new EPub(params, output);
      const op = await epub.render();
      expect(op).toMatchObject({ result: "ok" });
    });
  });
});
