import crypto from "crypto";

import jszip from "jszip";

export let zip;

export function getZip() {
  return zip;
}

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
export function openZip(data: Buffer | crypto.BinaryLike) {
  zip = new jszip(data.toString("binary"), {
    binary: true,
    base64: false,
    checkCRC32: true,
  });
}
