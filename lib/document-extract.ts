import { inflateRawSync, inflateSync } from "node:zlib";
import { extractExcelWithPython } from "./python-excel";

const MAX_EXTRACTED_TEXT = 10_000_000;
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
    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xlsm") || lowerName.endsWith(".xls")) {
      try {
        return limitText(await extractExcelWithPython(buffer, originalName));
      } catch (pythonError) {
        const pythonMessage = pythonError instanceof Error ? pythonError.message : String(pythonError);
        let fallback = "";
        try {
          fallback =
            lowerName.endsWith(".xls")
              ? extractXlsText(buffer, originalName)
              : extractXlsxText(buffer);
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          return emptyMessage(originalName, file.type, `Excel 解析失败：${pythonMessage}（备用解析：${fallbackMessage}）`);
        }
        return `${fallback}\n\n[提示：Python 解析失败（${pythonMessage}），已使用本地备用解析，建议检查 Python 依赖]`;
      }
    }
    if (lowerName.endsWith(".pptx")) return limitText(extractPptxText(buffer));
    if (lowerName.endsWith(".ppt")) {
      return emptyMessage(originalName, file.type, "旧版 .ppt 是二进制格式，当前本地版暂不解析；请另存为 .pptx 或导出 PDF 后上传。");
    }
    if (lowerName.endsWith(".doc")) {
      return emptyMessage(originalName, file.type, "旧版 .doc 是二进制格式，当前本地版暂不解析；请另存为 .docx 或 PDF 后上传。");
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
  const sharedStrings = parseSharedStrings(readZipText(zip, "xl/sharedStrings.xml") || "");
  const sheets = parseWorkbookSheets(readZipText(zip, "xl/workbook.xml") || "");
  const rels = parseWorkbookRels(readZipText(zip, "xl/_rels/workbook.xml.rels") || "");

  if (!sheets.length) {
    const fallback = zip.entries
      .map((entry) => entry.name)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
      .sort(naturalSort);
    return fallback
      .map((name, index) => {
        const xml = readZipText(zip, name) || "";
        const rows = parseXlsxRows(xml, sharedStrings);
        if (!rows.length) return "";
        return `工作表 ${index + 1}\n${rows.map((cells) => cells.join(" | ")).join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n");
  }

  return sheets
    .map((sheet, index) => {
      const candidates = [
        rels.get(sheet.rId),
        `worksheets/sheet${index + 1}.xml`,
        sheet.rId
      ]
        .filter(Boolean)
        .map((p) => (p && !p.startsWith("xl/") && !p.startsWith("/") ? `xl/${p}` : p?.replace(/^\//, "")))
        .filter(Boolean) as string[];
      const xml = candidates.map((p) => readZipText(zip, p)).find((v) => v) || "";
      const rows = parseXlsxRows(xml, sharedStrings);
      if (!rows.length) return "";
      const tableRows = rows.map((cells) => cells.join(" | ")).join("\n");
      return `${sheet.name}\n${tableRows}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function parseSharedStrings(xml: string): string[] {
  const items: string[] = [];
  if (!xml) return items;
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRe.exec(xml))) {
    items.push(extractXmlTextRuns(match[1] || "").join(""));
  }
  return items;
}

function parseWorkbookSheets(workbookXml: string) {
  const sheets: Array<{ name: string; rId: string }> = [];
  if (!workbookXml) return sheets;
  const re = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(workbookXml))) {
    sheets.push({ name: match[1], rId: match[2] });
  }
  return sheets;
}

function parseWorkbookRels(relsXml: string) {
  const map = new Map<string, string>();
  if (!relsXml) return map;
  const re = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(relsXml))) {
    map.set(match[1], match[2]);
  }
  return map;
}

function parseXlsxRows(sheetXml: string, sharedStrings: string[]) {
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\b([^>]*?)\br="([A-Za-z]+)\d*"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const rows: string[][] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(sheetXml))) {
    const rowBody = rowMatch[1] || "";
    const cells: Array<{ col: number; text: string }> = [];
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowBody))) {
      const attrs = `${cellMatch[1] || ""} ${cellMatch[3] || ""}`;
      const body = cellMatch[4] || "";
      let text = "";
      if (/\bt="s"/.test(attrs)) {
        const value = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
        text = value ? sharedStrings[Number(value)] ?? "" : "";
      } else if (/\bt="inlineStr"/.test(attrs)) {
        text = extractXmlTextRuns(body).join("").trim();
      } else if (/\bt="b"/.test(attrs)) {
        const value = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
        text = value === "1" || value === "true" ? "TRUE" : "FALSE";
      } else if (/\bt="str"/.test(attrs)) {
        const value = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
        text = value ? decodeXml(value) : "";
      } else if (/\bt="e"/.test(attrs)) {
        const value = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
        text = value ? `错误(${decodeXml(value)})` : "错误";
      } else {
        const value = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
        text = value !== undefined ? decodeXml(value) : "";
      }
      const colIndex = columnIndex(cellMatch[2]);
      if (colIndex >= 0) cells.push({ col: colIndex, text: text });
    }
    if (cells.length) {
      cells.sort((a, b) => a.col - b.col);
      const max = cells[cells.length - 1].col;
      const row = new Array(max + 1).fill("");
      for (const cell of cells) row[cell.col] = cell.text;
      rows.push(row);
    }
  }
  return rows;
}

function columnIndex(letters: string) {
  let result = 0;
  for (let i = 0; i < letters.length; i += 1) {
    const code = letters.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    result = result * 26 + (code - 64);
  }
  return result - 1;
}

function extractXlsText(buffer: Buffer, originalName: string) {
  const skip = buffer.length > 1024 ? 512 : 0;
  const scan = buffer.subarray(skip);
  const utf16 = extractOleStrings(scan, true);
  const ascii = extractOleStrings(scan, false);
  const merged = Array.from(new Set([...utf16, ...ascii]));
  if (!merged.length) {
    return emptyMessage(originalName, "", "旧版 .xls 是 BIFF 二进制格式，本地未做完整解析；可另存为 .xlsx 后再上传。");
  }
  return `工作表（按可识别字符串顺序）\n${merged.join("\n")}`;
}

function extractOleStrings(buffer: Buffer, utf16: boolean) {
  const minLen = utf16 ? 2 : 4;
  const step = utf16 ? 2 : 1;
  let current = "";
  const runs: string[] = [];
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed.length >= minLen && hasLettersOrDigits(trimmed)) runs.push(trimmed);
    current = "";
  };
  for (let offset = 0; offset <= buffer.length - step; offset += step) {
    if (utf16 && offset + 2 > buffer.length) break;
    const code = utf16 ? buffer.readUInt16LE(offset) : buffer[offset];
    if (isXlsPrintable(code)) {
      current += String.fromCharCode(code);
    } else if (code === 0x09) {
      current += " ";
    } else {
      flush();
    }
  }
  flush();
  return Array.from(new Set(runs.map((line) => line.replace(/\s+/g, " ").trim())));
}

function isXlsPrintable(code: number) {
  if (code === 0x20) return true;
  if (code < 0x1f || code === 0x7f) return false;
  if (code >= 0x2000 && code <= 0x206f) return true;
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  if (code >= 0xff00 && code <= 0xffef) return true;
  if (code >= 0x3000 && code <= 0x303f) return true;
  return code >= 0x20 && code <= 0x7e;
}

function hasLettersOrDigits(value: string) {
  return /[A-Za-z0-9一-鿿]/.test(value);
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
  const re = /<(?:\w+:t|t)\b[^>]*>([\s\S]*?)<\/(?:\w+:t|t)>/g;
  return [...xml.matchAll(re)].map((match) => decodeXml(match[1]));
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
