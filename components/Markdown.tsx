"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  content: string;
};

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const language = /language-(\w+)/.exec(className || "")?.[1];
  return (
    <code className={className} data-language={language}>
      {children}
    </code>
  );
}

const components: Components = {
  a({ children, ...props }) {
    return (
      <a {...props} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  code({ children, className, ...rest }) {
    const isBlock = /language-/.test(className || "") || (typeof children === "string" && children.includes("\n"));
    if (!isBlock) {
      return (
        <code className="md-inline-code" {...rest}>
          {children}
        </code>
      );
    }
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  table({ children }) {
    return (
      <div className="md-table-wrap">
        <table>{children}</table>
      </div>
    );
  }
};

const TRANSITION_PATTERNS: RegExp[] = [
  /^因此[,,]/,
  /^综上[,,]/,
  /^所以[,,]/,
  /^下面[,,]/,
  /^以下是[,,]/,
  /^下面给出/,
  /^下面是/,
  /^现在我来/,
  /^我来回答/,
  /^我会这样回答/,
  /^接下来[,,]/,
  /^现在[,,]/,
  /^好[,,]/,
  /^好的[,,]/,
  /^OK[,,]/,
  /^回答如下[::]/,
  /^答复如下[::]/,
  /^结论[::]/,
  /^最终答案[::]/,
  /^答案[::]/,
  /^\|/
];

const H2_HEADING = /^##\s/;

function extractByTags(content: string): { thinking: string; answer: string } | null {
  const tagPairs: Array<[string, string]> = [
    ["<think>", "</think>"],
    ["<thinking>", "</thinking>"],
    ["<reasoning>", "</reasoning>"],
    ["<reflection>", "</reflection>"]
  ];
  for (const [openTag, closeTag] of tagPairs) {
    const escapedOpen = openTag.replace(/[<>]/g, "\\$&");
    const escapedClose = closeTag.replace(/[<>]/g, "\\$&");
    const closedRegex = new RegExp(`${escapedOpen}([\\s\\S]*?)${escapedClose}`, "g");
    const parts: string[] = [];
    let buffer = content;
    const pieces: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = closedRegex.exec(buffer)) !== null) {
      pieces.push(buffer.slice(lastIndex, match.index));
      parts.push(match[1].trim());
      lastIndex = match.index + match[0].length;
    }
    pieces.push(buffer.slice(lastIndex));
    let answer = pieces.join("").trim();

    const lastOpen = answer.lastIndexOf(openTag);
    if (lastOpen !== -1) {
      const openContent = answer.slice(lastOpen + openTag.length);
      if (openContent.trim()) parts.push(openContent.trim());
      answer = answer.slice(0, lastOpen).trim();
    }

    const thinking = parts.filter(Boolean).join("\n\n");
    if (thinking) return { thinking, answer };
  }
  return null;
}

function extractByMarkdownHeading(content: string): { thinking: string; answer: string } | null {
  const lines = content.split("\n");
  let splitIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (H2_HEADING.test(lines[i])) {
      splitIndex = i;
      break;
    }
  }
  if (splitIndex < 0) return null;
  if (splitIndex === 0) {
    return { thinking: "", answer: content };
  }
  return {
    thinking: lines.slice(0, splitIndex).join("\n").trim(),
    answer: lines.slice(splitIndex).join("\n").trim()
  };
}

function extractByTransition(content: string): { thinking: string; answer: string } | null {
  const paragraphs = content.split(/\n\s*\n/);
  for (let i = 0; i < paragraphs.length; i++) {
    const line = paragraphs[i].trim();
    if (!line) continue;
    if (TRANSITION_PATTERNS.some((re) => re.test(line))) {
      if (i === 0) return null;
      return {
        thinking: paragraphs.slice(0, i).join("\n\n").trim(),
        answer: paragraphs.slice(i).join("\n\n").trim()
      };
    }
  }
  return null;
}

function splitThinking(content: string): { thinking: string; answer: string } {
  if (!content) return { thinking: "", answer: "" };
  return (
    extractByTags(content) ||
    extractByMarkdownHeading(content) ||
    extractByTransition(content) || { thinking: "", answer: content }
  );
}

export function Markdown({ content }: Props) {
  const text = useMemo(() => content || "", [content]);
  const { thinking, answer } = useMemo(() => splitThinking(text), [text]);
  if (!text) return null;
  return (
    <div className="markdown-body">
      {thinking && (
        <details className="md-thinking">
          <summary>思考过程</summary>
          <div className="md-thinking-content">{thinking}</div>
        </details>
      )}
      {answer && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {answer}
        </ReactMarkdown>
      )}
    </div>
  );
}
