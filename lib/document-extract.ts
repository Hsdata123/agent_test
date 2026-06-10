import { inflateRawSync, inflateSync } from "node:zlib";

const MAX_EXTRACTED_TEXT = 80_000;
const textExtensions = [".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".xml", ".html", ".css"];

type ZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
};

export async function extractDocumentText(file: File, originalName: string) {
  const lowerName = originalName.toLowerCase();
  const textLike = file.type.startsWith("text/") || textExtensions.some((ext) => lowerName.endsWith(ext));
  if (textLike) return limitText(await file.text());

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    if (lowerName.endsWith(".pdf") || file.type.includes("pdf")) {
      return limitText(extractPdfText(buffer) || emptyMessage(originalName, file.type, "PDF 可能是扫描图片版，当前未做 OCR 识别。"));
    }
    if (lowerName.endsWith(".docx")) return limitText(extractDocxText(buffer));
    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xlsm")) return limitText(extractXlsxText(buffer));
    if (lowerName.endsWith(".pptx")) return limitText(extractPptxText(buffer));
    if (lowerName.endsWith(".ppt")) {
      return emptyMessage(originalName, file.type, "旧版 .ppt 是二进制格式，当前本地版暂不解析；请另存为 .pptx 或导出 PDF 后上传。");
    }
    if (lowerName.endsWith(".doc")) {
      return emptyMessage(originalName, file.type, "旧版 .doc 是二进制格式，当前本地版暂不解析；请另存为 .docx 或 PDF 后上传。");
    }
    if (lowerName.endsWith(".xls")) {
      return emptyMessage(originalName, file.type, "旧版 .xls 是二进制格式，当前本地版暂不解析；请另存为 .xlsx 或 CSV 后上传。");
    }
    return emptyMessage(originalName, file.type, "当前文件格式暂未解析全文，已保存文件本身和文件名。");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyMessage(originalName, file.type, `解析失败：${message}`);
  }
}

function extractDocxText(buffer: Buffer) {
  const zip = readZip(buffer);
  const parts = [
    "word/document.xml",
    ...zip.entries.map((entry) => entry.name).filter((name) => /^word\/(header|footer)\d+\.xml$/i.test(name))
  ];
  return parts
    .map((name) => xmlText(readZipText(zip, name) || ""))
    .filter(Boolean)
    .join("\n\n");
}

function extractPptxText(buffer: Buffer) {
  const zip = readZip(buffer);
  const slideNames = zip.entries
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(naturalSort);
  const noteNames = zip.entries
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name))
    .sort(naturalSort);

  const slides = slideNames
    .map((name, index) => {
      const text = xmlText(readZipText(zip, name) || "");
      return text ? `幻灯片 ${index + 1}\n${text}` : "";
    })
    .filter(Boolean);
  const notes = noteNames
    .map((name, index) => {
      const text = xmlText(readZipText(zip, name) || "");
      return text ? `备注 ${index + 1}\n${text}` : "";
    })
    .filter(Boolean);

  return [...slides, ...notes].join("\n\n");
}

function extractXlsxText(buffer: Buffer) {
  const zip = readZip(buffer);
  const sharedStrings = extractXmlTextRuns(readZipText(zip, "xl/sharedStrings.xml") || "");
  const sheetNames = zip.entries
    .map((entry) => entry.name)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(naturalSort);

  return sheetNames
    .map((name, index) => {
      const xml = readZipText(zip, name) || "";
      const cells = [...xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
        .map((match) => {
          const attrs = match[1] || "";
          const body = match[2] || "";
          if (/\bt="s"/.test(attrs)) {
            const value = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
            return value ? sharedStrings[Number(value)] || "" : "";
          }
          if (/\bt="inlineStr"/.test(attrs)) return xmlText(body);
          return decodeXml(body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || "");
        })
        .map((cell) => cell.trim())
        .filter(Boolean);
      return cells.length ? `工作表 ${index + 1}\n${cells.join(" | ")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractPdfText(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  const streamTexts = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((match) => {
      const streamBuffer = Buffer.from(match[1], "latin1");
      const before = raw.slice(Math.max(0, match.index - 500), match.index);
      if (/FlateDecode/.test(before)) {
        try {
          return inflateSync(streamBuffer).toString("latin1");
        } catch {
          return "";
        }
      }
      return match[1];
    })
    .join("\n");
  return normalizeText(`${pdfTextOperators(raw)}\n${pdfTextOperators(streamTexts)}`);
}

function pdfTextOperators(input: string) {
  const pieces = [
    ...[...input.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((match) => decodePdfString(match[1])),
    ...[...input.matchAll(/\[((?:\s*\((?:\\.|[^\\)])*\)\s*-?\d*)+)\]\s*TJ/g)].map((match) =>
      [...match[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((part) => decodePdfString(part[1])).join("")
    )
  ];
  return pieces.join("\n");
}

function decodePdfString(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function readZip(buffer: Buffer) {
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) throw new Error("不是有效的 Office 压缩文档");
  const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    entries.push({ name, compressedSize, uncompressedSize, compressionMethod, localHeaderOffset });
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return { buffer, entries };
}

function readZipText(zip: ReturnType<typeof readZip>, name: string) {
  const entry = zip.entries.find((item) => item.name === name);
  if (!entry) return "";
  const data = readZipEntry(zip.buffer, entry);
  return data.toString("utf8");
}

function readZipEntry(buffer: Buffer, entry: ZipEntry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`文件 ${entry.name} 的压缩头无效`);
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraFieldLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;
  const data = buffer.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return data;
  if (entry.compressionMethod === 8) return inflateRawSync(data, { finishFlush: 2 });
  throw new Error(`文件 ${entry.name} 的压缩方式暂不支持`);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function xmlText(xml: string) {
  return normalizeText(extractXmlTextRuns(xml).join("\n"));
}

function extractXmlTextRuns(xml: string) {
  return [...xml.matchAll(/<[^:>\s]+:?t(?:\s[^>]*)?>([\s\S]*?)<\/[^:>]+:?t>/g)].map((match) => decodeXml(match[1]));
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function limitText(value: string) {
  const text = normalizeText(value);
  return text.length > MAX_EXTRACTED_TEXT ? `${text.slice(0, MAX_EXTRACTED_TEXT)}\n\n[内容过长，已截断]` : text;
}

function emptyMessage(originalName: string, mimeType: string, reason: string) {
  return [`用户上传了文件：${originalName}`, `文件类型：${mimeType || "未知"}`, reason].join("\n");
}

function naturalSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
