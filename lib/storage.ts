import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();

export const uploadDir = path.join(root, "storage", "uploads");
export const resultDir = path.join(root, "storage", "results");

export async function ensureStorage() {
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.mkdir(resultDir, { recursive: true });
}

const MAX_SAFE_NAME = 80;

export function safeFileName(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim() || "file";
  if (cleaned.length <= MAX_SAFE_NAME) return cleaned;
  // 保留扩展名 (任意长度), 防止 CJK + 超长文件名让 storagePath 损坏或超 Windows MAX_PATH
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) {
    return cleaned.slice(0, MAX_SAFE_NAME);
  }
  const ext = cleaned.slice(dot);
  if (ext.length >= MAX_SAFE_NAME) {
    return cleaned.slice(0, MAX_SAFE_NAME);
  }
  return cleaned.slice(0, MAX_SAFE_NAME - ext.length) + ext;
}

export function nameWithoutExt(fileName: string) {
  return safeFileName(fileName).replace(/\.[^.]+$/, "");
}

export async function saveUpload(file: File) {
  await ensureStorage();
  const originalName = safeFileName(file.name);
  const storedName = `${Date.now()}-${crypto.randomUUID()}-${originalName}`;
  const storagePath = path.join(uploadDir, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storagePath, bytes);
  return { originalName, storagePath, size: bytes.length };
}

export async function saveResultFromBuffer(buffer: Buffer, extension = "png") {
  await ensureStorage();
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(resultDir, fileName);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function getImageDimensions(filePath: string) {
  const buffer = await fs.readFile(filePath);
  return getImageDimensionsFromBuffer(buffer);
}

export function getImageDimensionsFromBuffer(buffer: Buffer) {
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return getJpegDimensions(buffer);
  }
  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return getWebpDimensions(buffer);
  }
  return { width: undefined, height: undefined };
}

export function publicFileUrl(storagePath: string) {
  const encoded = Buffer.from(storagePath, "utf8").toString("base64url");
  return `/api/files/${encoded}`;
}

function getJpegDimensions(buffer: Buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return { width: undefined, height: undefined };
}

function getWebpDimensions(buffer: Buffer) {
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }
  return { width: undefined, height: undefined };
}
