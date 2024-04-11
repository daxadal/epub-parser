import assert from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";

import { EPub } from "../src/html-to-epub";
import { EpubOptions } from "../src/html-to-epub.types";

async function runTestOn(input: string): Promise<boolean> {
  const params = JSON.parse(
    readFileSync(resolve(__dirname, `./${input}.json`), { encoding: "utf8" })
  ) as EpubOptions;
  const output = resolve(__dirname, `./${input}.epub`);

  const epub = new EPub(params, output);
  const op = await epub.render();
  return op.result === "ok";
}

it("Ebook > generate v2", async () => {
  assert.strictEqual(await runTestOn("book-v2"), true);
});

it("Ebook > generate v3", async () => {
  assert.strictEqual(await runTestOn("book-v3"), true);
});

it("HTML Page > generate v2", async () => {
  assert.strictEqual(await runTestOn("article-v2"), true);
});

it("HTML Page > generate v3", async () => {
  assert.strictEqual(await runTestOn("article-v3"), true);
});
