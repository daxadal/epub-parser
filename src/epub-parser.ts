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
  let md5: string;
  let navMapHTML: string | null;

  let container: {
      rootfiles: { rootfile: { [x: string]: { [x: string]: any } }[] }[];
    },
    opf: { [x: string]: any[] },
    ncx: { [x: string]: { [x: string]: any }[] },
    opfPath: any,
    ncxPath: string,
    opsRoot: string,
    primaryIdName: any,
    primaryIdValue: string | undefined,
    primaryIdSchema: any,
    opfXML: { toString: () => convertableToString },
    ncxXML: string,
    opfPrefix = "",
    dcPrefix = "",
    ncxPrefix = "",
    metadata: any,
    manifest: any,
    spine: { itemref: any; $: { toc: any } },
    // guide: any,
    nav: any,
    root: string,
    ns: string,
    ncxId: any,
    epub3CoverId: any,
    epub3NavId: any,
    epub3NavHtml: string | undefined,
    epub2CoverUrl: string | null,
    isEpub3: boolean,
    epubVersion: string;
  let itemlist: { [x: string]: any }, itemreflist: { [x: string]: { $: any } };
  let itemHashById;
  let itemHashByHref;
  let linearSpine;
  // let spineOrder: any[];
  let simpleMeta: Record<string, any>[];

  async function readAndParseData(data: string | Buffer): Promise<any> {
    md5 = crypto.createHash("md5").update(data).digest("hex");

    zip = new jszip(data.toString("binary"), {
      binary: true,
      base64: false,
      checkCRC32: true,
    });
    const containerData = extractText("META-INF/container.xml");

    const containerJSON = await parser.parseStringPromise(containerData);
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
    opfXML = extractText(root);

    const opfJSON = await parser.parseStringPromise(opfXML.toString());

    // store opf data
    opf = opfJSON["opf:package"] ?? opfJSON["package"];
    primaryIdName = opf["$"]["unique-identifier"];
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

    // guide = opf?.[opfPrefix + "guide"]?.[0];

    ncxId = spine?.$?.toc;

    // spine
    itemlist = manifest.item;

    itemreflist = spine.itemref;

    ({ itemHashById, itemHashByHref, epub3CoverId, epub3NavId, epub3NavHtml } =
      buildItemHashes(itemlist, opsRoot));

    ({ /* spineOrder, */ linearSpine } = buildLinearSpine(
      itemreflist,
      itemHashById
    ));

    // metadata
    ({ simpleMeta, epub2CoverUrl, primaryIdValue, primaryIdSchema } =
      buildMetadataLists(metadata, primaryIdName, itemHashById, opsRoot));

    if (!ncxId) {
      // assume epub 3 navigation doc
      if (!isEpub3)
        throw new Error("ncx id not found but package indicates epub 2");

      ncxXML = "";
      ncx = {};
      ncxPath = "";
      navMapHTML = null;

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
      ncxXML = extractText(ncxPath);

      const ncxJSON = await parser.parseStringPromise(ncxXML.toString());

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

      navMapHTML = "<ul>";
      for (let i = 0; i < (navPoints ?? []).length; i++) {
        navMapHTML += processNavPoint(navPoints[i]);
      }
      navMapHTML += "</ul>" + "\n";
      epubdata = getEpubDataBlock();

      return epubdata;
    }
  }

  function getEpubDataBlock() {
    return {
      easy: {
        primaryID: {
          name: primaryIdName,
          value: primaryIdValue,
          scheme: primaryIdSchema,
        },
        epubVersion,
        isEpub3,
        md5,
        epub3NavHtml,
        navMapHTML,
        linearSpine,
        itemHashById,
        itemHashByHref,
        simpleMeta,
        epub3CoverId,
        epub3NavId,
        epub2CoverUrl,
      },
      paths: {
        opfPath,
        ncxPath,
        opsRoot,
      },
      raw: {
        json: {
          prefixes: {
            opfPrefix,
            dcPrefix,
            ncxPrefix,
          },
          container,
          opf,
          ncx,
          nav,
        },
        xml: {
          opfXML,
          ncxXML,
        },
      },
    };
  }

  let data: Buffer | string;
  if (Buffer.isBuffer(filename)) {
    data = filename;
  } else if (/^https?:\/\//i.exec(filename)) {
    data = await new Promise<Buffer>((resolve, reject) =>
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
  } else {
    // assume local full path to file
    data = await fs.readFile(filename, "binary");
  }
  return readAndParseData(data);
} // end #open function definition block

export function getZip() {
  return zip;
}
export function getJsZip() {
  return jszip;
}
