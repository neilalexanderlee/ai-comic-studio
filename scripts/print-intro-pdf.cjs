/**
 * 将 docs/ai-competition-intro.html 导出为 A4 PDF。
 *
 * 优先使用本机 Google Chrome（无头 --print-to-pdf，无需下载 Chromium）。
 * macOS：默认尝试 /Applications/Google Chrome.app/...
 * 可通过环境变量 CHROME_BIN 指定可执行文件。
 *
 * 运行：node scripts/print-intro-pdf.cjs
 *
 * 若无 Chrome，可安装 puppeteer 后使用旧路径：
 * npx --yes -p puppeteer node scripts/print-intro-pdf-puppeteer.cjs（若存在）
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function defaultChromePath() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  if (process.platform === "darwin") {
    const p =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (fs.existsSync(p)) return p;
  }
  if (process.platform === "linux") {
    for (const p of ["/usr/bin/google-chrome", "/usr/bin/chromium-browser"]) {
      if (fs.existsSync(p)) return p;
    }
  }
  if (process.platform === "win32") {
    const p =
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function main() {
  const root = path.resolve(__dirname, "..");
  const htmlPath = path.join(root, "docs", "ai-competition-intro.html");
  const outPath = path.join(root, "docs", "AI大赛-项目介绍.pdf");

  if (!fs.existsSync(htmlPath)) {
    console.error("找不到:", htmlPath);
    process.exit(1);
  }

  const chrome = defaultChromePath();
  if (!chrome) {
    console.error(
      "未找到 Chrome/Chromium。请安装 Google Chrome，或设置环境变量 CHROME_BIN 指向 chrome 可执行文件。"
    );
    process.exit(1);
  }

  const fileUrl = `file://${htmlPath}`;
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${outPath}`,
      fileUrl,
    ],
    { stdio: "inherit" }
  );
  console.log("已生成:", outPath);
}

main();
