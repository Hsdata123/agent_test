import type { Metadata } from "next";
import "antd/dist/reset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 电商主图 / 详情页生成管理系统",
  description: "Web 测试版 MVP"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                const shouldIgnore = (args) => String(args && args[0] || '').includes('[antd: compatible]');
                const originalError = console.error;
                const originalWarn = console.warn;
                console.error = (...args) => {
                  if (shouldIgnore(args)) return;
                  originalError.apply(console, args);
                };
                console.warn = (...args) => {
                  if (shouldIgnore(args)) return;
                  originalWarn.apply(console, args);
                };
              })();
            `
          }}
        />
        {children}
      </body>
    </html>
  );
}
