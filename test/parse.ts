import { inspector } from "eyes";

import { open } from "../src/epub-parser";

const inspect = inspector({
  styles: {
    special: "green", // null, undefined...
    string: "grey",
    number: "magenta",
    bool: "blue", // true false
    regexp: "green",
    // /\d+/
  },
  maxLength: undefined,
});

if (!process.argv[2]) {
  throw "You must supply a path to a valid EPUB file!";
}
open(process.argv[2]).then(
  (epubData: any) => {
    inspect(epubData.easy);

    //inspect(epubData.raw.json.ncx);

    // uncomment the following lines to run a test of the zip lib using the included test epub

    //var zip = getZip();

    //var file = zip.file('OPS/main23.xml').asText();

    //inspect(file);

    //  if(!file.match(/-/)) {
    //   throw "Corrupt xml file deflated from test epub. The sequence '—' is not found meaning UTF-8 was corrupted";
    // }

    //inspect(filestat);

    console.log("tests passed");
  },
  (err) => inspect(err)
);
