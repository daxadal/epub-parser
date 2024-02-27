import fs from "fs/promises";
import crypto from "crypto";

import jszip from "jszip";
import { Parser, convertableToString } from "xml2js";
import request from "request";

let zip;
const parser = new Parser();

export function extractText(filename: string) {
  //console.log('extracting '+filename);
  const file = zip.file(filename);
  if (typeof file !== "undefined" || file !== null) {
    return file.asText();
  } else {
    throw "file " + filename + " not found in zip";
  }
}

export function extractBinary(filename: any) {
  const file = zip.file(filename);
  if (typeof file !== "undefined") {
    return file.asBinary();
  } else {
    return "";
  }
}

export async function open(filename: PathLike | FileHandle): Promise<unknown> {
  return new Promise(async (resolve, reject) => {
    /*

			"filename" is still called "filename" but now it can be
			a full file path, a full URL, or a Buffer object
			we should eventually change its name...

		*/

    let epubdata = {};
    let md5hash: string;
    let htmlNav: string | null = "<ul>";

    let container: {
        rootfiles: { rootfile: { [x: string]: { [x: string]: any } }[] }[];
      },
      opf: { [x: string]: any[] },
      ncx: { [x: string]: { [x: string]: any }[] },
      opfPath: any,
      ncxPath: string,
      opsRoot: string,
      uniqueIdentifier: any,
      uniqueIdentifierValue: string,
      uniqueIdentifierScheme = null,
      opfDataXML: { toString: () => convertableToString },
      ncxDataXML: string,
      opfPrefix = "",
      dcPrefix = "",
      ncxPrefix = "",
      metadata: any,
      manifest: {
        [x: string]: { [x: string]: { [x: string]: { href: any } } };
        item: any;
      },
      spine: { itemref: any; $: { toc: any } },
      guide: any,
      nav: any,
      root: string,
      ns: string,
      ncxId: any,
      epub3CoverId: any,
      epub3NavId: any,
      epub3NavHtml: convertableToString,
      epub2CoverUrl = null,
      isEpub3: boolean,
      epubVersion: string;
    let itemlist: { [x: string]: any },
      itemreflist: { [x: string]: { $: any } };
    const itemHashById = {};
    const itemHashByHref = {};
    const linearSpine = {};
    const spineOrder = [];
    const simpleMeta = [];

    function readAndParseData(
      /* Buffer */ data: crypto.BinaryLike | Buffer,
      cb: (arg0: Error | null, arg1?: any) => void
    ) {
      md5hash = crypto.createHash("md5").update(data).digest("hex");

      zip = new jszip(data.toString("binary"), {
        binary: true,
        base64: false,
        checkCRC32: true,
      });
      const containerData = extractText("META-INF/container.xml");

      parseEpub(containerData).then(
        (epubData) => cb(null, epubData),
        (err) => cb(err)
      );
    }

    async function parseEpub(
      containerDataXML: convertableToString
    ): Promise<any> {
      /*
      Parsing chain walking down the metadata of an epub,
      and storing it in the JSON config object
    */

      const containerJSON = await parser.parseStringPromise(containerDataXML);
      const epubData = await parseContainer(containerJSON);
      return epubData;
    }

    async function parseContainer(containerJSON: {
      container: any;
    }): Promise<any> {
      container = containerJSON.container;

      // determine location of OPF
      opfPath = root = container.rootfiles[0].rootfile[0]["$"]["full-path"];
      //  console.log('opfPath is:'+opfPath);

      // set the opsRoot for resolving paths
      if (root.match(/\//)) {
        // not at top level
        opsRoot = root.replace(/\/([^/]+)\.opf/i, "");
        if (!opsRoot.match(/\/$/)) {
          // does not end in slash, but we want it to
          opsRoot += "/";
        }
        if (opsRoot.match(/^\//)) {
          opsRoot = opsRoot.replace(/^\//, "");
        }
      } else {
        // at top level
        opsRoot = "";
      }

      console.log("opsRoot is:" + opsRoot + " (derived from " + root + ")");

      // get the OPF data and parse it
      console.log("parsing OPF data");
      opfDataXML = extractText(root);

      const opfJSON = await parser.parseStringPromise(opfDataXML.toString());

      // store opf data
      opf = opfJSON["opf:package"]
        ? opfJSON["opf:package"]
        : opfJSON["package"];
      uniqueIdentifier = opf["$"]["unique-identifier"];
      epubVersion = opf["$"]["version"][0];

      isEpub3 = epubVersion == "3" || epubVersion == "3.0" ? true : false;

      //  console.log('epub version:'+epubVersion);
      for (const att in opf["$"]) {
        if (att.match(/^xmlns:/)) {
          ns = att.replace(/^xmlns:/, "");
          if (opf["$"][att] == "http://www.idpf.org/2007/opf")
            opfPrefix = ns + ":";
          if (opf["$"][att] == "http://purl.org/dc/elements/1.1/")
            dcPrefix = ns + ":";
        }
      }

      parsePackageElements();

      // spine
      itemlist = manifest.item;

      itemreflist = spine.itemref;

      buildItemHashes();

      buildLinearSpine();

      // metadata
      buildMetadataLists();

      if (!ncxId) {
        // assume epub 3 navigation doc
        if (!isEpub3)
          throw new Error("ncx id not found but package indicates epub 2");

        ncxDataXML = "";
        ncx = {};
        ncxPath = "";
        htmlNav = null;

        if (!epub3NavHtml) throw new Error("epub 3 with no nav html");

        const navJSON = await parser.parseStringPromise(epub3NavHtml);

        nav = navJSON;
        epubdata = getEpubDataBlock();
        return epubdata;
      } else {
        // epub 2, use ncx doc
        for (const item in manifest[opfPrefix + "item"]) {
          if (manifest[opfPrefix + "item"][item]["$"].id == ncxId) {
            ncxPath = opsRoot + manifest[opfPrefix + "item"][item]["$"].href;
          }
        }
        //console.log('determined ncxPath:'+ncxPath);
        ncxDataXML = extractText(ncxPath);

        const ncxJSON = await parser.parseStringPromise(ncxDataXML.toString());

        function setPrefix(ncxJSON: { [x: string]: { [x: string]: string } }) {
          for (const att in ncxJSON["$"]) {
            //console.log(att);
            if (att.match(/^xmlns:/)) {
              const ns = att.replace(/^xmlns:/, "");
              if (ncxJSON["$"][att] == "http://www.daisy.org/z3986/2005/ncx/")
                ncxPrefix = ns + ":";
            }
          }
        }

        // grab the correct ns prefix for ncx
        for (const prop in ncxJSON) {
          //console.log(prop);
          if (prop === "$") {
            // normal parse result
            setPrefix(ncxJSON);
          } else {
            if (typeof ncxJSON[prop]["$"] !== "undefined") {
              //console.log(ncxJSON[prop]['$']);
              setPrefix(ncxJSON[prop]);
            }
          }
        }

        ncx = ncxJSON[ncxPrefix + "ncx"];

        const navPoints = ncx[ncxPrefix + "navMap"][0][ncxPrefix + "navPoint"];

        for (let i = 0; i < (navPoints ?? []).length; i++) {
          processNavPoint(navPoints[i]);
        }
        htmlNav += "</ul>" + "\n";
        epubdata = getEpubDataBlock();
        return epubdata;
      }
    }

    function processNavPoint(np: {
      navLabel: { text: string[] }[];
      content: { [x: string]: { src: string } }[];
      navPoint: any[];
    }) {
      let text = "Untitled";
      let src = "#";

      if (typeof np.navLabel !== "undefined") {
        text = np.navLabel[0].text[0];
      }
      if (typeof np.content !== "undefined") {
        src = np.content[0]["$"].src;
      }

      htmlNav += '<li><a href="' + src + '">' + text + "</a>";

      if (typeof np.navPoint !== "undefined") {
        htmlNav += "<ul>";
        for (let i = 0; i < (np.navPoint ?? []).length; i++) {
          processNavPoint(np.navPoint[i]);
        }
        htmlNav += "</ul>" + "\n";
      }
      htmlNav += "</li>" + "\n";
    }

    function buildItemHashes() {
      for (const item in itemlist) {
        const href = itemlist[item].$.href;
        const id = itemlist[item].$.id;
        const properties = itemlist[item].$["properties"];
        if (typeof properties !== "undefined") {
          if (properties == "cover-image") {
            epub3CoverId = id;
          } else if (properties == "nav") {
            epub3NavId = id;
            epub3NavHtml = extractText(opsRoot + href);
          }
        }
        itemHashByHref[href] = itemlist[item];
        itemHashById[id] = itemlist[item];
      }

      try {
        ncxId = spine.$.toc;
      } catch (e) {}
    }

    function buildLinearSpine() {
      for (const itemref in itemreflist) {
        const id = itemreflist[itemref].$.idref;

        spineOrder.push(itemreflist[itemref].$);

        if (
          itemreflist[itemref].$.linear == "yes" ||
          typeof itemreflist[itemref].$.linear == "undefined"
        ) {
          itemreflist[itemref].$.item = itemHashById[id];
          linearSpine[id] = itemreflist[itemref].$;
        }
      }
    }

    function buildMetadataLists() {
      const metas = metadata;
      for (const prop in metas) {
        if (prop == "meta") {
          // process a list of meta tags

          for (let i = 0; i < (metas[prop] ?? []).length; i++) {
            const m = metas[prop][i].$;

            if (typeof m.name !== "undefined") {
              const md = {};
              md[m.name] = m.content;
              simpleMeta.push(md);
            } else if (typeof m.property !== "undefined") {
              const md = {};
              md[m.property] = metas[prop][i]._;
              simpleMeta.push(md);
            }

            if (m.name == "cover") {
              if (typeof itemHashById[m.content] !== "undefined") {
                epub2CoverUrl = opsRoot + itemHashById[m.content].$.href;
              }
            }
          }
        } else if (prop != "$") {
          let content = "";
          const atts = {};
          if (metas[prop][0]) {
            if (metas[prop][0].$ || metas[prop][0]._) {
              // complex tag
              content = metas[prop][0]._ ? metas[prop][0]._ : metas[prop][0];

              if (metas[prop][0].$) {
                // has attributes
                for (const att in metas[prop][0].$) {
                  atts[att] = metas[prop][0].$[att];
                }
              }
            } else {
              // simple one, if object, assume empty
              content = typeof metas[prop][0] == "object" ? "" : metas[prop][0];
            }
          }
          if (typeof prop !== "undefined") {
            const md = {};
            md[prop] = content;
            simpleMeta.push(md);
          }

          if (prop.match(/identifier$/i)) {
            if (typeof metas[prop][0].$.id) {
              if (metas[prop][0].$.id == uniqueIdentifier) {
                if (typeof content == "object") {
                  console.log("warning - content not fully parsed");
                  console.log(content);
                  console.log(metas[prop][0].$.id);
                } else {
                  uniqueIdentifierValue = content;
                  if (typeof metas[prop][0].$.scheme !== "undefined") {
                    uniqueIdentifierScheme = metas[prop][0].$.scheme;
                  }
                }
              }
            }
          }
        }
      }
    }

    function parsePackageElements() {
      // operates on global vars

      if (typeof opf[opfPrefix + "manifest"] === "undefined") {
        // it's a problem
        // gutenberg files, for example will lead to this condition
        // we must assume that tags are not actually namespaced

        opfPrefix = "";
      }

      try {
        metadata = opf[opfPrefix + "metadata"][0];
      } catch (e) {
        console.log("metadata element error: " + e.message);
        console.log(
          "are the tags really namespaced with " +
            opfPrefix +
            " or not? file indicates they should be."
        );
      }
      try {
        manifest = opf[opfPrefix + "manifest"][0];
      } catch (e) {
        console.log("manifest element error: " + e.message);
        console.log(
          "are the tags really namespaced with " +
            opfPrefix +
            " or not? file indicates they should be."
        );
        console.log(opfDataXML);
        console.log(opf);
        console.log("must throw this - unrecoverable");
        throw e;
      }
      try {
        spine = opf[opfPrefix + "spine"][0];
      } catch (e) {
        console.log("spine element error: " + e.message);
        console.log("must throw this");
        throw e;
      }
      try {
        guide = opf[opfPrefix + "guide"][0];
      } catch (e) {}
    }

    function getEpubDataBlock() {
      return {
        easy: {
          primaryID: {
            name: uniqueIdentifier,
            value: uniqueIdentifierValue,
            scheme: uniqueIdentifierScheme,
          },
          epubVersion: epubVersion,
          isEpub3: isEpub3,
          md5: md5hash,
          epub3NavHtml: epub3NavHtml,
          navMapHTML: htmlNav,
          linearSpine: linearSpine,
          itemHashById: itemHashById,
          itemHashByHref: itemHashByHref,
          simpleMeta: simpleMeta,
          epub3CoverId: epub3CoverId,
          epub3NavId: epub3NavId,
          epub2CoverUrl: epub2CoverUrl,
        },
        paths: {
          opfPath: opfPath,
          ncxPath: ncxPath,
          opsRoot: opsRoot,
        },
        raw: {
          json: {
            prefixes: {
              opfPrefix: opfPrefix,
              dcPrefix: dcPrefix,
              ncxPrefix: ncxPrefix,
            },
            container: container,
            opf: opf,
            ncx: ncx,
            nav: nav,
          },
          xml: {
            opfXML: opfDataXML,
            ncxXML: ncxDataXML,
          },
        },
      };
    }

    if (Buffer.isBuffer(filename)) {
      console.log("epub-parser parsing from buffer, not file");

      readAndParseData(filename, (err, epubData) =>
        err ? reject(err) : resolve(epubData)
      );
    } else if (filename.match(/^https?:\/\//i)) {
      // is a URL

      request(
        {
          uri: filename,
          encoding: null /* sets the response to be a buffer */,
        },
        function (error, response, body) {
          if (!error && response.statusCode == 200) {
            const b = body;

            readAndParseData(b, (err, epubData) =>
              err ? reject(err) : resolve(epubData)
            );
          } else {
            reject(error);
          }
        }
      );
    } else {
      // assume local full path to file
      try {
        const data = await fs.readFile(filename, "binary");
        readAndParseData(data, (err, epubData) =>
          err ? reject(err) : resolve(epubData)
        );
      } catch (err) {
        reject(err);
      }
    }
  });
} // end #open function definition block

export function getZip() {
  return zip;
}
export function getJsZip() {
  return jszip;
}
