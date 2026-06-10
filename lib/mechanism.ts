export type ParsedMechanism = {
  raw: string;
  price: number;
  productSummary: string;
  products: { productName: string; quantity: number }[];
};

export type ParseIssue = {
  line: number;
  raw: string;
  message: string;
};

export function parseMechanisms(rawText: string) {
  const parsed: ParsedMechanism[] = [];
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();

  rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const lineNo = index + 1;
      if (seen.has(line)) {
        issues.push({ line: lineNo, raw: line, message: `第 ${lineNo} 行检测到重复机制` });
      }
      seen.add(line);

      if (!line.includes("=")) {
        issues.push({ line: lineNo, raw: line, message: `第 ${lineNo} 行机制格式错误，请使用“价格=产品*数量”格式` });
        return;
      }
      const [priceRaw, ...rest] = line.split("=");
      const productSummary = rest.join("=").trim();
      if (!priceRaw.trim()) {
        issues.push({ line: lineNo, raw: line, message: `第 ${lineNo} 行缺少价格` });
        return;
      }
      const price = Number(priceRaw.trim());
      if (!Number.isFinite(price)) {
        issues.push({ line: lineNo, raw: line, message: `第 ${lineNo} 行价格格式错误` });
        return;
      }
      if (!productSummary) {
        issues.push({ line: lineNo, raw: line, message: `第 ${lineNo} 行缺少产品组合` });
        return;
      }

      const products = productSummary.split("+").map((item) => {
        const trimmed = item.trim();
        const match = trimmed.match(/^(.*?)(?:\*(\d+))?$/);
        const productName = match?.[1]?.trim() || trimmed;
        const quantity = match?.[2] ? Number(match[2]) : 1;
        return { productName, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1 };
      });

      if (products.some((item) => !item.productName)) {
        issues.push({ line: lineNo, raw: line, message: `第 ${lineNo} 行产品数量格式错误` });
        return;
      }

      parsed.push({ raw: line, price, productSummary, products });
    });

  return { parsed, issues };
}
