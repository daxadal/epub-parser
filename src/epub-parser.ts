import fs from "fs/promises";
import crypto from "crypto";

import jszip from "jszip";
import { Parser, convertableToString } from "xml2js";
import request from "request";

import {
  parsePackageElements,
  buildItemHashes,
  buildLinearSpine,
  buildMetadataLists,
  setPrefix,
  processNavPoint,
} from "./parser-utils";

const parser = new Parser();

let zip;

export function extractText(filename: string) {
  const file = zip.file(filename);
  if (file) {
    return file.asText();
  } else {
    throw new Error("file " + filename + " not found in zip");
  }
}

export function extractBinary(filename: any) {
  const file = zip.file(filename);
  if (file) {
    return file.asBinary();
  } else {
    return "";
  }
}

export async function open(filename: string | Buffer): Promise<unknown> {
  /*

			"filename" is still called "filename" but now it can be
			a full file path, a full URL, or a Buffer object
			we should eventually change its name...

		*/

  let epubdata = {};
  let md5hash: string;
  let htmlNav: string | null;

  let container: {
      rootfiles: { rootfile: { [x: string]: { [x: string]: any } }[] }[];
    },
    opf: { [x: string]: any[] },
    ncx: { [x: string]: { [x: string]: any }[] },
    opfPath: any,
    ncxPath: string,
    opsRoot: string,
    uniqueIdentifier: any,
    uniqueIdentifierValue: string | undefined,
    uniqueIdentifierScheme: any,
    opfDataXML: { toString: () => convertableToString },
    ncxDataXML: string,
    opfPrefix = "",
    dcPrefix = "",
    ncxPrefix = "",
    metadata: any,
    manifest: any,
    spine: { itemref: any; $: { toc: any } },
    guide: any,
    nav: any,
    root: string,
    ns: string,
    ncxId: any,
    epub3CoverId: any,
    epub3NavId: any,
    epub3NavHtml: convertableToString,
    epub2CoverUrl: string | null,
    isEpub3: boolean,
    epubVersion: string;
  let itemlist: { [x: string]: any }, itemreflist: { [x: string]: { $: any } };
  let itemHashById;
  let itemHashByHref;
  let linearSpine;
  let spineOrder: any[];
  let simpleMeta: Record<string, any>[];

  function readAndParseData(
    /* Buffer */ data: crypto.BinaryLike | Buffer
  ): Promise<any> {
    md5hash = crypto.createHash("md5").update(data).digest("hex");

    zip = new jszip(data.toString("binary"), {
      binary: true,
      base64: false,
      checkCRC32: true,
    });
    const containerData = extractText("META-INF/container.xml");

    return parseEpub(containerData);
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

    // set the opsRoot for resolving paths
    if (/\//.exec(root)) {
      // not at top level
      opsRoot = root.replace(/\/([^/]+)\.opf/i, "");
      if (!/\/$/.exec(opsRoot)) {
        // does not end in slash, but we want it to
        opsRoot += "/";
      }
      if (/^\//.exec(opsRoot)) {
        opsRoot = opsRoot.replace(/^\//, "");
      }
    } else {
      // at top level
      opsRoot = "";
    }

    // get the OPF data and parse it
    opfDataXML = extractText(root);

    const opfJSON = await parser.parseStringPromise(opfDataXML.toString());

    // store opf data
    opf = opfJSON["opf:package"] ?? opfJSON["package"];
    uniqueIdentifier = opf["$"]["unique-identifier"];
    epubVersion = opf["$"]["version"][0];

    isEpub3 = epubVersion === "3" || epubVersion === "3.0";

    for (const att in opf["$"]) {
      if (/^xmlns:/.exec(att)) {
        ns = att.replace(/^xmlns:/, "");
        if (opf["$"][att] === "http://www.idpf.org/2007/opf")
          opfPrefix = ns + ":";
        if (opf["$"][att] === "http://purl.org/dc/elements/1.1/")
          dcPrefix = ns + ":";
      }
    }

    if (!opf[opfPrefix + "manifest"]) {
      // it's a problem
      // gutenberg files, for example will lead to this condition
      // we must assume that tags are not actually namespaced

      opfPrefix = "";
    }

    ({ metadata, manifest, spine } = parsePackageElements(opf, opfPrefix));

    guide = opf?.[opfPrefix + "guide"]?.[0];

    ncxId = spine?.$?.toc;

    // spine
    itemlist = manifest.item;

    itemreflist = spine.itemref;

    ({ itemHashById, itemHashByHref, epub3CoverId, epub3NavId, epub3NavHtml } =
      buildItemHashes(itemlist, opsRoot));

    ({ spineOrder, linearSpine } = buildLinearSpine(itemreflist, itemHashById));

    // metadata
    ({
      simpleMeta,
      epub2CoverUrl,
      uniqueIdentifierValue,
      uniqueIdentifierScheme,
    } = buildMetadataLists(metadata, uniqueIdentifier, itemHashById, opsRoot));

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
        if (manifest[opfPrefix + "item"][item]["$"].id === ncxId) {
          ncxPath = opsRoot + manifest[opfPrefix + "item"][item]["$"].href;
        }
      }
      ncxDataXML = extractText(ncxPath);

      const ncxJSON = await parser.parseStringPromise(ncxDataXML.toString());

      // grab the correct ns prefix for ncx

      let attrs;
      if (ncxJSON["$"]) attrs = ncxJSON["$"];
      else {
        const foundProp = Object.keys(ncxJSON).find(
          (prop) => ncxJSON[prop]["$"]
        );
        attrs = foundProp ? ncxJSON[foundProp]["$"] : undefined;
      }

      ncxPrefix = attrs ? setPrefix(attrs) : "";

      ncx = ncxJSON[ncxPrefix + "ncx"];

      const navPoints = ncx[ncxPrefix + "navMap"][0][ncxPrefix + "navPoint"];

      htmlNav = "<ul>";
      for (let i = 0; i < (navPoints ?? []).length; i++) {
        htmlNav += processNavPoint(navPoints[i]);
      }
      htmlNav += "</ul>" + "\n";
      epubdata = getEpubDataBlock();
      return epubdata;
    }
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
        guide: guide,
        epub3NavHtml: epub3NavHtml,
        navMapHTML: htmlNav,
        linearSpine: linearSpine,
        spineOrder: spineOrder,
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

  const buffer = await transformToBuffer(filename);
  return readAndParseData(buffer);
} // end #open function definition block

async function transformToBuffer(filename: string | Buffer) {
  if (Buffer.isBuffer(filename)) {
    return filename;
  } else if (/^https?:\/\//i.exec(filename)) {
    // is a URL

    const body = await new Promise<Buffer>((resolve, reject) =>
      request(
        {
          uri: filename,
          encoding: null /* sets the response to be a buffer */,
        },
        function (error, response, body) {
          if (!error && response.statusCode === 200) {
            resolve(body);
          } else {
            reject(error);
          }
        }
      )
    );
    return body;
  } else {
    // assume local full path to file

    const data = await fs.readFile(filename, "binary");
    return data;
  }
}

export function getZip() {
  return zip;
}
export function getJsZip() {
  return jszip;
}
