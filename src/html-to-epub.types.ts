export interface EpubContentOptions {
  title: string;
  data: string;
  url?: string;
  author?: Array<string> | string;
  filename?: string;
  excludeFromToc?: boolean;
  beforeToc?: boolean;
}

export interface EpubContent {
  id: string;
  href: string;
  title: string;
  data: string;
  url: string | null;
  author: Array<string>;
  filePath: string;
  templatePath: string;
  excludeFromToc: boolean;
  beforeToc: boolean;
}

export interface EpubOptions {
  title: string;
  description: string;
  cover?: string;
  publisher?: string;
  author?: Array<string> | string;
  tocTitle?: string;
  appendChapterTitles?: boolean;
  date?: string;
  lang?: string;
  css?: string;
  fonts?: Array<string>;
  content: Array<EpubContentOptions>;
  customOpfTemplatePath?: string;
  customNcxTocTemplatePath?: string;
  customHtmlTocTemplatePath?: string;
  customHtmlCoverTemplatePath?: string;
  version?: number;
  userAgent?: string;
  verbose?: boolean;
  tempDir?: string;
}

export interface EpubImage {
  id: string;
  url: string;
  dir: string;
  mediaType: string;
  extension: string;
}
