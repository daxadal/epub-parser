import { extractText } from "./epub-parser";

export function setPrefix(attrs: { [x: string]: string }): string {
  const foundEntry = Object.entries(attrs).find(
    ([att, value]) =>
      /^xmlns:/.exec(att) && value === "http://www.daisy.org/z3986/2005/ncx/"
  );
  return foundEntry ? foundEntry[0].replace(/^xmlns:/, "") + ":" : "";
}
export function processNavPoint(np: {
  navLabel: { text: string[] }[];
  content: { [x: string]: { src: string } }[];
  navPoint: any[];
}) {
  let text = "Untitled";
  let src = "#";

  if (np.navLabel) {
    text = np.navLabel[0].text[0];
  }
  if (np.content) {
    src = np.content[0]["$"].src;
  }

  let htmlNav = '<li><a href="' + src + '">' + text + "</a>";

  if (np.navPoint) {
    htmlNav += "<ul>";
    for (let i = 0; i < (np.navPoint ?? []).length; i++) {
      htmlNav += processNavPoint(np.navPoint[i]);
    }
    htmlNav += "</ul>" + "\n";
  }
  htmlNav += "</li>" + "\n";
  return htmlNav;
}
export function buildItemHashes(
  itemlist: Record<string, any>,
  opsRoot: string
) {
  const itemHashById = {};
  const itemHashByHref = {};
  let epub3CoverId: any, epub3NavId: any, epub3NavHtml: string | undefined;

  for (const item in itemlist) {
    const href = itemlist[item].$.href;
    const id = itemlist[item].$.id;
    const properties = itemlist[item].$["properties"];
    if (properties) {
      if (properties === "cover-image") {
        epub3CoverId = id;
      } else if (properties === "nav") {
        epub3NavId = id;
        epub3NavHtml = extractText(opsRoot + href);
      }
    }
    itemHashByHref[href] = itemlist[item];
    itemHashById[id] = itemlist[item];
  }
  return {
    itemHashById,
    itemHashByHref,
    epub3CoverId,
    epub3NavId,
    epub3NavHtml,
  };
}
export function buildLinearSpine(
  itemreflist: { [x: string]: { $: any } },
  itemHashById: any
) {
  const spineOrder: any[] = [];
  const linearSpine = {};

  for (const itemref in itemreflist) {
    const id = itemreflist[itemref].$.idref;

    spineOrder.push(itemreflist[itemref].$);

    if (
      itemreflist[itemref].$.linear === "yes" ||
      !itemreflist[itemref].$.linear
    ) {
      itemreflist[itemref].$.item = itemHashById[id];
      linearSpine[id] = itemreflist[itemref].$;
    }
  }

  return { spineOrder, linearSpine };
}
export function buildMetadataLists(
  metas: any,
  primaryIdName: any,
  itemHashById: any,
  opsRoot: string
) {
  let epub2CoverUrl: string | null = null;
  const simpleMeta: Record<string, any>[] = [];
  let primaryIdValue: string | undefined,
    primaryIdSchema: any = null;

  for (const prop in metas) {
    if (prop === "meta") {
      // process a list of meta tags
      for (let i = 0; i < (metas[prop] ?? []).length; i++) {
        const m = metas[prop][i].$;

        if (m.name) {
          simpleMeta.push({ [m.name]: m.content });
        } else if (m.property) {
          simpleMeta.push({ [m.property]: metas[prop][i]._ });
        }

        if (m.name === "cover") {
          if (itemHashById[m.content]) {
            epub2CoverUrl = opsRoot + itemHashById[m.content].$.href;
          }
        }
      }
    } else if (prop !== "$") {
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
          content = typeof metas[prop][0] === "object" ? "" : metas[prop][0];
        }
      }
      if (prop) {
        const md = {};
        md[prop] = content;
        simpleMeta.push(md);
      }

      if (
        /identifier$/i.exec(prop) &&
        metas[prop][0].$.id &&
        metas[prop][0].$.id === primaryIdName
      ) {
        if (typeof content === "object") {
          console.log("warning - content not fully parsed");
          console.log(content);
          console.log(metas[prop][0].$.id);
        } else {
          primaryIdValue = content;
          if (metas[prop][0].$.scheme) {
            primaryIdSchema = metas[prop][0].$.scheme;
          }
        }
      }
    }
  }

  return {
    simpleMeta,
    epub2CoverUrl,
    primaryIdValue: primaryIdValue,
    primaryIdSchema: primaryIdSchema,
  };
}
export function parsePackageElements(
  opf: Record<string, any[]>,
  opfPrefix: string
) {
  let metadata: any;
  try {
    metadata = opf[opfPrefix + "metadata"][0];
  } catch (e: any) {
    console.log("metadata element error: " + e.message);
    console.log(
      "are the tags really namespaced with " +
        opfPrefix +
        " or not? file indicates they should be."
    );
  }

  let manifest: {
    [x: string]: { [x: string]: { [x: string]: { href: any } } };
    item: any;
  };
  try {
    manifest = opf[opfPrefix + "manifest"][0];
  } catch (e: any) {
    console.log("manifest element error: " + e.message);
    console.log(
      "are the tags really namespaced with " +
        opfPrefix +
        " or not? file indicates they should be."
    );
    console.log(opf);
    console.log("must throw this - unrecoverable");
    throw e;
  }

  let spine: { itemref: any; $: { toc: any } };
  try {
    spine = opf[opfPrefix + "spine"][0];
  } catch (e: any) {
    console.log("spine element error: " + e.message);
    console.log("must throw this");
    throw e;
  }

  return { metadata, manifest, spine };
}
