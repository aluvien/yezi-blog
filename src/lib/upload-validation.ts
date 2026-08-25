export const MAX_UPLOAD_SIZE = 20 * 1024 * 1024;
export const MAX_UPLOAD_REQUEST_SIZE = 21 * 1024 * 1024;
export const MAX_UPLOAD_PIXELS = 60 * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "application/zip": ".zip",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

function hasBytes(buffer: Buffer, offset: number, bytes: number[]): boolean {
  return bytes.every((value, index) => buffer[offset + index] === value);
}

function hasZipSignature(buffer: Buffer): boolean {
  return hasBytes(buffer, 0, [0x50, 0x4b, 0x03, 0x04]) || hasBytes(buffer, 0, [0x50, 0x4b, 0x05, 0x06]);
}

/**
 * Client MIME is only a claim. Binary types must also match an inert file
 * signature; DOCX has an additional container check so an arbitrary ZIP cannot
 * be recorded or served as a Word document.
 */
export function hasValidUploadSignature(mime: string, buffer: Buffer): boolean {
  if (mime === "image/jpeg") return hasBytes(buffer, 0, [0xff, 0xd8, 0xff]);
  if (mime === "image/png") return hasBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (mime === "image/gif") return buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a";
  if (mime === "application/pdf") return buffer.toString("ascii", 0, 5) === "%PDF-";
  if (mime === "application/zip") return hasZipSignature(buffer);
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return hasZipSignature(buffer) && buffer.includes(Buffer.from("[Content_Types].xml")) && buffer.includes(Buffer.from("word/document.xml"));
  }
  if (mime === "application/msword") return hasBytes(buffer, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  // 纯文本和 Markdown 没有可靠的魔数；存储端固定用 .txt/.md 与安全 MIME 提供。
  return mime === "text/plain" || mime === "text/markdown";
}

export function hasSafeImageDimensions(width: number | undefined, height: number | undefined): boolean {
  return Boolean(width && height && width > 0 && height > 0 && width * height <= MAX_UPLOAD_PIXELS);
}
