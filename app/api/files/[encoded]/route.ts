import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

const roots = [path.join(process.cwd(), "storage", "uploads"), path.join(process.cwd(), "storage", "results")];

export async function GET(_request: Request, context: { params: Promise<{ encoded: string }> }) {
  const { encoded } = await context.params;
  const filePath = Buffer.from(encoded, "base64url").toString("utf8");
  const resolved = path.resolve(filePath);
  const allowed = roots.some((root) => resolved.startsWith(path.resolve(root)));
  if (!allowed || !fs.existsSync(resolved)) {
    return NextResponse.json({ success: false, message: "文件不存在或已被删除" }, { status: 404 });
  }
  const stream = fs.createReadStream(resolved);
  return new Response(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType(resolved),
      "Content-Disposition": `inline; filename="${encodeURIComponent(path.basename(resolved))}"`
    }
  });
}

function contentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png"].includes(ext)) return "image/png";
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}
