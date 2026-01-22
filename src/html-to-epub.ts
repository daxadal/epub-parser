import {
  ReadStream,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, resolve } from "path";
import { promisify } from "util";

import archiver from "archiver";
import axios from "axios";
import { remove as diacritics } from "diacritics";
import { renderFile } from "ejs";
import { encodeXML } from "entities";
import fsExtra, { copySync, removeSync } from "fs-extra";
import type { Element } from "hast";
import { imageSize } from "image-size";
import mime from "mime";
import rehypeParse from "rehype-parse";
import rehypeStringify from "rehype-stringify";
import { Plugin, unified } from "unified";
import { visit } from "unist-util-visit";
import uslug from "uslug";
import { v4 as uuidV4 } from "uuid";

import { allowedAttributes, allowedXhtml11Tags } from "./constants-gen";
import {
  EpubContent,
  EpubContentOptions,
  EpubImage,
  EpubOptions,
} from "./html-to-epub.types";

export class EPub {
  uuid: string;
  title: string;
  description: string;
  cover: string | null;
  coverMediaType: string | null;
  coverExtension: string | null;
  coverDimensions = {
    width: 0,
    height: 0,
  };
  publisher: string;
  author: Array<string>;
  tocTitle: string;
  appendChapterTitles: boolean;
  date: string;
  lang: string;
  css: string | null;
  fonts: Array<string>;
  content: Array<EpubContent>;
  images: Array<EpubImage>;
  customOpfTemplatePath: string | null;
  customNcxTocTemplatePath: string | null;
  customHtmlCoverTemplatePath: string | null;
  customHtmlTocTemplatePath: string | null;
  version: number;
  userAgent: string;
  verbose: boolean;
  tempDir: string;
  tempEpubDir: string;
  output: string;

  readonly logger = {
    log: (...args: any[]) => {
      if (this.verbose) {
        console.log(...args);
      }
    },
    error: (...args: any[]) => {
      if (this.verbose) {
        console.log(...args);
      }
    },
  };

  constructor(options: EpubOptions, output: string) {
    // File ID
    this.uuid = uuidV4();

    // Required options
    this.title = options.title;
    this.description = options.description;
    this.output = output;

    // Options with defaults
    this.cover = options.cover ?? null;
    this.publisher = options.publisher ?? "anonymous";
    this.author =
      Array.isArray(options.author) && options.author.length > 0
        ? options.author
        : typeof options.author === "string"
        ? [options.author]
        : ["anonymous"];
    this.tocTitle = options.tocTitle ?? "Table Of Contents";
    this.appendChapterTitles = options.appendChapterTitles ?? true;
    this.date = options.date ?? new Date().toISOString();
    this.lang = options.lang ?? "en";
    this.css = options.css ?? null;
    this.fonts = options.fonts ?? [];
    this.customOpfTemplatePath = options.customOpfTemplatePath ?? null;
    this.customNcxTocTemplatePath = options.customNcxTocTemplatePath ?? null;
    this.customHtmlTocTemplatePath = options.customHtmlTocTemplatePath ?? null;
    this.customHtmlCoverTemplatePath =
      options.customHtmlCoverTemplatePath ?? null;
    this.version = options.version ?? 3;
    this.userAgent =
      options.userAgent ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.105 Safari/537.36";
    this.verbose = options.verbose ?? false;

    // Temporary folder for work
    this.tempDir = options.tempDir ?? resolve(__dirname, "../tempDir/");
    this.tempEpubDir = resolve(this.tempDir, this.uuid);

    // Check the cover image
    if (this.cover !== null) {
      this.coverMediaType = mime.getType(this.cover);
      if (this.coverMediaType === null) {
        throw new Error(`The cover image can't be processed : ${this.cover}`);
      }
      this.coverExtension = mime.getExtension(this.coverMediaType);
      if (this.coverExtension === null) {
        throw new Error(`The cover image can't be processed : ${this.cover}`);
      }
    } else {
      this.coverMediaType = null;
      this.coverExtension = null;
    }

    this.images = [];
    this.content = [];

    // Insert cover in content
    if (this.cover) {
      const templatePath =
        this.customHtmlCoverTemplatePath ??
        resolve(__dirname, "../templates/cover.xhtml.ejs");
      if (!existsSync(templatePath)) {
        throw new Error("Could not resolve path to cover template HTML.");
      }

      this.content.push({
        id: `item_${this.content.length}`,
        href: "cover.xhtml",
        title: "cover",
        data: "",
        url: null,
        author: [],
        filePath: resolve(this.tempEpubDir, `./OEBPS/cover.xhtml`),
        templatePath,
        excludeFromToc: true,
        beforeToc: true,
      });
    }

    // Parse contents & save images
    const contentTemplatePath = resolve(
      __dirname,
      "../templates/content.xhtml.ejs"
    );
    const contentOffset = this.content.length;
    this.content.push(
      ...options.content.map<EpubContent>((content, i) =>
        this.parseContent(content, contentOffset + i, contentTemplatePath)
      )
    );
  }

  readonly loadHtml = (content: string, plugins: Plugin[]) =>
    unified()
      .use(rehypeParse, { fragment: true })
      .use(plugins)
      // Voids: [] is required for epub generation, and causes little/no harm for non-epub usage
      .use(rehypeStringify, { allowDangerousHtml: true, voids: [] })
      .processSync(content)
      .toString();

  private parseContent(
    content: EpubContentOptions,
    index: number,
    contentTemplatePath: string
  ) {
    // Get the content URL & path
    let href;
    if (content.filename === undefined) {
      const titleSlug = uslug(diacritics(content.title ?? "no title"));
      href = `${index}_${titleSlug}.xhtml`;
    } else if (/\.xhtml$/.exec(content.filename)) {
      href = content.filename;
    } else {
      href = `${content.filename}.xhtml`;
    }
    const filePath = resolve(this.tempEpubDir, `./OEBPS/${href}`);

    // Content ID & directory
    const id = `item_${index}`;
    const dir = dirname(filePath);

    // Parse the content
    const html = this.loadHtml(content.data, [
      () => (tree) => {
        visit(tree, "element", (node: Element) =>
          this.validateElements(node, index)
        );
      },
      () => (tree) => {
        visit(tree, "element", (node: Element) =>
          this.processImgTags(node, dir)
        );
      },
    ]);

    // Return the EpubContent
    return {
      id,
      href,
      title: content.title,
      data: html,
      url: content.url ?? null,
      author: Array.isArray(content.author)
        ? content.author
        : typeof content.author === "string"
        ? [content.author]
        : [],
      filePath,
      templatePath: contentTemplatePath,
      excludeFromToc: content.excludeFromToc === true, // Default to false
      beforeToc: content.beforeToc === true, // Default to false
    };
  }

  private validateElements(node: Element, index: number) {
    const attrs = node.properties;
    if (node.tagName === "img") {
      node.properties.alt = node.properties.alt ?? "image-placeholder";
    }

    for (const [propName, propValue] of Object.entries(attrs)) {
      if (
        !allowedAttributes.includes(propName) ||
        (propName === "type" && propValue !== "script")
      ) {
        delete node.properties[propName];
      }
    }

    if (this.version === 2 && !allowedXhtml11Tags.includes(node.tagName)) {
      this.logger.log(
        "Warning (content[" + index + "]):",
        node.tagName,
        "tag isn't allowed on EPUB 2/XHTML 1.1 DTD."
      );

      node.tagName = "div";
    }
  }

  private processImgTags(node: Element, dir: string) {
    if (!["img", "input"].includes(node.tagName)) {
      return;
    }
    const url = node.properties.src as string | null | undefined;
    if (url === undefined || url === null) {
      return;
    }

    let extension, id;
    const image = this.images.find((element) => element.url === url);
    if (image) {
      id = image.id;
      extension = image.extension;
    } else {
      id = uuidV4();
      const mediaType = mime.getType(url.replace(/\?.*/, ""));
      if (mediaType === null) {
        this.logger.error(
          "[Image Error]",
          `The image can't be processed : ${url}`
        );

        return;
      }
      extension = mime.getExtension(mediaType);
      if (extension === null) {
        this.logger.error(
          "[Image Error]",
          `The image can't be processed : ${url}`
        );

        return;
      }
      this.images.push({ id, url, dir, mediaType, extension });
    }
    node.properties.src = `images/${id}.${extension}`;
  }

  async render(): Promise<{ result: string }> {
    // Create directories
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir);
    }
    mkdirSync(this.tempEpubDir);
    mkdirSync(resolve(this.tempEpubDir, "./OEBPS"));

    this.logger.log("Downloading Images...");
    await this.downloadAllImage(this.images);

    this.logger.log("Making Cover...");
    await this.makeCover();

    this.logger.log("Generating Template Files.....");
    await this.generateTempFile(this.content);

    this.logger.log("Generating Epub Files...");
    await this.generate();

    this.logger.log("Done.");
    return { result: "ok" };
  }

  private async generateTempFile(contents: Array<EpubContent>) {
    // Create the document's Header
    const docHeader =
      this.version === 2
        ? `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="${this.lang}">
`
        : `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${this.lang}">
`;

    // Copy the CSS style
    if (!this.css) {
      this.css = readFileSync(resolve(__dirname, "../templates/template.css"), {
        encoding: "utf8",
      });
    }
    writeFileSync(resolve(this.tempEpubDir, "./OEBPS/style.css"), this.css);

    // Copy fonts
    if (this.fonts.length) {
      mkdirSync(resolve(this.tempEpubDir, "./OEBPS/fonts"));
      this.fonts = this.fonts.map((font) => {
        if (!existsSync(font)) {
          throw new Error(`Custom font not found at ${font}.`);
        }
        const filename = basename(font);
        copySync(font, resolve(this.tempEpubDir, `./OEBPS/fonts/${filename}`));
        return filename;
      });
    }

    // Write content files
    for (const content of contents) {
      const result = await renderFile(
        content.templatePath,
        {
          ...this,
          ...content,
          bookTitle: this.title,
          encodeXML,
          docHeader,
        },
        {
          escape: (markup) => markup,
        }
      );
      writeFileSync(content.filePath, result);
    }

    // write meta-inf/container.xml
    mkdirSync(this.tempEpubDir + "/META-INF");
    writeFileSync(
      `${this.tempEpubDir}/META-INF/container.xml`,
      '<?xml version="1.0" encoding="UTF-8" ?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    );

    if (this.version === 2) {
      // write meta-inf/com.apple.ibooks.display-options.xml [from pedrosanta:xhtml#6]
      writeFileSync(
        `${this.tempEpubDir}/META-INF/com.apple.ibooks.display-options.xml`,
        `
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<display_options>
  <platform name="*">
    <option name="specified-fonts">true</option>
  </platform>
</display_options>
`
      );
    }

    const opfPath =
      this.customOpfTemplatePath ??
      resolve(__dirname, `../templates/epub${this.version}/content.opf.ejs`);
    if (!existsSync(opfPath)) {
      throw new Error("Custom file to OPF template not found.");
    }
    writeFileSync(
      resolve(this.tempEpubDir, "./OEBPS/content.opf"),
      await renderFile(opfPath, this)
    );

    const ncxTocPath =
      this.customNcxTocTemplatePath ??
      resolve(__dirname, "../templates/toc.ncx.ejs");
    if (!existsSync(ncxTocPath)) {
      throw new Error("Custom file the NCX toc template not found.");
    }
    writeFileSync(
      resolve(this.tempEpubDir, "./OEBPS/toc.ncx"),
      await renderFile(ncxTocPath, this)
    );

    const htmlTocPath =
      this.customHtmlTocTemplatePath ??
      resolve(__dirname, `../templates/epub${this.version}/toc.xhtml.ejs`);
    if (!existsSync(htmlTocPath)) {
      throw new Error("Custom file to HTML toc template not found.");
    }
    writeFileSync(
      resolve(this.tempEpubDir, "./OEBPS/toc.xhtml"),
      await renderFile(htmlTocPath, this)
    );
  }

  private async makeCover(): Promise<void> {
    if (this.cover === null) {
      return;
    }

    const destPath = resolve(
      this.tempEpubDir,
      `./OEBPS/cover.${this.coverExtension}`
    );

    let writeStream: fsExtra.ReadStream;
    if (this.cover.startsWith("http") || this.cover.startsWith("//")) {
      try {
        const httpRequest = await axios.get(this.cover, {
          responseType: "stream",
          headers: { "User-Agent": this.userAgent },
        });
        writeStream = httpRequest.data;
        writeStream.pipe(createWriteStream(destPath));
      } catch (err) {
        this.logger.error(
          `The cover image can't be processed : ${this.cover}, ${err}`
        );

        return;
      }
    } else {
      writeStream = createReadStream(this.cover);
      writeStream.pipe(createWriteStream(destPath));
    }

    const promiseStream = new Promise<void>((resolve, reject) => {
      writeStream.on("end", () => resolve());
      writeStream.on("error", (err) => {
        console.error("Error", err);
        unlinkSync(destPath);
        reject(err);
      });
    });

    await promiseStream;

    this.logger.log("[Success] cover image downloaded successfully!");

    const sizeOf = promisify(imageSize);

    // Retrieve image dimensions
    const result = await sizeOf(destPath);
    if (!result || !result.width || !result.height) {
      throw new Error(
        `Failed to retrieve cover image dimensions for "${destPath}"`
      );
    }

    this.coverDimensions.width = result.width;
    this.coverDimensions.height = result.height;

    this.logger.log(
      `cover image dimensions: ${this.coverDimensions.width} x ${this.coverDimensions.height}`
    );
  }

  private async downloadImage(image: EpubImage): Promise<void> {
    const filename = resolve(
      this.tempEpubDir,
      `./OEBPS/images/${image.id}.${image.extension}`
    );

    if (image.url.startsWith("file://")) {
      const auxpath = image.url.substring(7);
      copySync(auxpath, filename);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let requestAction: ReadStream;
    if (image.url.startsWith("http") || image.url.startsWith("//")) {
      try {
        const httpRequest = await axios.get(image.url, {
          responseType: "stream",
          headers: { "User-Agent": this.userAgent },
        });
        requestAction = httpRequest.data;
        requestAction.pipe(createWriteStream(filename));
      } catch (err) {
        this.logger.error(
          `The image can't be processed : ${image.url}, ${err}`
        );
        return;
      }
    } else {
      requestAction = createReadStream(resolve(image.dir, image.url));
      requestAction.pipe(createWriteStream(filename));
    }

    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requestAction.on("error", (err) => {
        this.logger.error(
          "[Download Error]",
          "Error while downloading",
          image.url,
          err
        );

        unlinkSync(filename);
        reject(err);
      });

      requestAction.on("end", () => {
        this.logger.log("[Download Success]", image.url);
        resolve();
      });
    });
  }

  private async downloadAllImage(images: Array<EpubImage>): Promise<void> {
    if (images.length === 0) {
      return;
    }

    mkdirSync(resolve(this.tempEpubDir, "./OEBPS/images"));
    for (const image of images) {
      await this.downloadImage(image);
    }
  }

  private generate(): Promise<void> {
    // Thanks to Paul Bradley
    // http://www.bradleymedia.org/gzip-markdown-epub/ (404 as of 28.07.2016)
    // Web Archive URL:
    // http://web.archive.org/web/20150521053611/http://www.bradleymedia.org/gzip-markdown-epub
    // or Gist:
    // https://gist.github.com/cyrilis/8d48eef37fbc108869ac32eb3ef97bca

    const cwd = this.tempEpubDir;

    return new Promise((resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 9 } });
      const output = createWriteStream(this.output);
      this.logger.log("Zipping temp dir to", this.output);
      archive.append("application/epub+zip", { store: true, name: "mimetype" });
      archive.directory(cwd + "/META-INF", "META-INF");
      archive.directory(cwd + "/OEBPS", "OEBPS");
      archive.pipe(output);
      archive.on("end", () => {
        this.logger.log("Done zipping, clearing temp dir...");
        removeSync(cwd);
        resolve();
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      archive.on("error", (err) => reject(err));
      archive.finalize();
    });
  }
}
