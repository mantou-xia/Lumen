import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDirectory = resolve(webDirectory, "../..");
const dataDirectory = join(rootDirectory, ".lumen-data", "e2e-smoke");
const edgeExecutable = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const processes = [];

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: rootDirectory, stdio: "ignore", ...options });
  processes.push(child);
  return child;
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 服务启动期间连接失败属于预期状态，继续轮询。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`服务未就绪：${url}`);
}

async function providerInvocationCount() {
  const response = await fetch("http://127.0.0.1:4420/stats");
  return (await response.json()).invocationCount;
}

async function waitForProviderInvocationCount(expected) {
  let actual = -1;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    actual = await providerInvocationCount();
    if (actual === expected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Provider Invocation 数量预期 ${expected}，实际 ${actual}`);
}

async function selectReaderText(page, selectedText) {
  await page.evaluate((textToSelect) => {
    const paragraph = document.querySelector('[data-block-type="paragraph"]');
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let fullText = "";
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      nodes.push({ node, start: fullText.length, end: fullText.length + node.textContent.length });
      fullText += node.textContent;
    }
    const start = fullText.indexOf(textToSelect);
    const end = start + textToSelect.length;
    const startNode = nodes.find((item) => item.start <= start && item.end >= start);
    const endNode = nodes.find((item) => item.start <= end && item.end >= end);
    if (start < 0 || startNode === undefined || endNode === undefined) {
      throw new Error(`Reader 中找不到待选择文本：${textToSelect}`);
    }
    const range = document.createRange();
    range.setStart(startNode.node, start - startNode.start);
    range.setEnd(endNode.node, end - endNode.start);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, selectedText);
}

function startLocalService() {
  return start(process.execPath, [join(rootDirectory, "apps", "local-service", "dist", "main.js")], {
    env: {
      ...process.env,
      LUMEN_DATA_DIR: dataDirectory,
      LUMEN_PORT: "4430",
      LUMEN_AI_PRESET: "openai-compatible",
      LUMEN_AI_BASE_URL: "http://127.0.0.1:4420/v1",
      LUMEN_AI_MODEL: "smoke-model",
      LUMEN_HTTPS_PROXY: "http://127.0.0.1:9",
    },
  });
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await once(child, "exit");
}

async function main() {
  await rm(dataDirectory, { recursive: true, force: true });
  start(process.execPath, [join(webDirectory, "scripts", "mock-provider.mjs")], {
    env: { ...process.env, MOCK_PROVIDER_PORT: "4420" },
  });
  const localService = startLocalService();
  start(
    process.execPath,
    [join(webDirectory, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "4411"],
    { cwd: webDirectory, env: { ...process.env, LUMEN_PORT: "4430" } },
  );
  await waitFor("http://127.0.0.1:4430/api/health");
  await waitFor("http://127.0.0.1:4411/");

  const browser = await chromium.launch({ executablePath: edgeExecutable, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:4411/settings");
  await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
  await page.locator(".theme-choice--sepia").click();
  await page.locator('html[data-theme="sepia"]').waitFor();
  await page.getByRole("button", { name: "840px" }).click();
  await page.getByRole("button", { name: "20px" }).click();
  await page.goto("http://127.0.0.1:4411/");
  await page.locator('html[data-theme="sepia"]').waitFor();
  const logoLoaded = await page.locator(".library-brand img").evaluate((image) => (
    image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
  ));
  if (!logoLoaded) throw new Error("Lumen 文字 Logo 未正确加载");
  await page.setInputFiles('input[type="file"]', {
    name: "First Reading.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# First Reading\n\n## Seeing clearly\n\nWe learn to see with the heart when appearances are misleading.\n\n### A smaller idea\n\nDetails support the chapter.\n\n## Continuing\n\nThe next chapter keeps the reading moving."),
  });
  await page.getByRole("button", { name: "导入文档" }).click();
  await page.locator(".library-document-card", { hasText: "First Reading.md" }).getByRole("link").first().click();
  try {
    await page.waitForSelector(".markdown-reader", { timeout: 5000 });
  } catch (error) {
    console.error(JSON.stringify({ url: page.url(), pageErrors, text: await page.locator("body").innerText() }, null, 2));
    throw error;
  }
  const readerTypography = await page.locator(".markdown-reader").evaluate((element) => ({
    maxWidth: getComputedStyle(element).maxWidth,
    fontSize: getComputedStyle(element).fontSize,
  }));
  if (readerTypography.maxWidth !== "840px" || readerTypography.fontSize !== "20px") {
    throw new Error(`Reader 未应用设置偏好：${JSON.stringify(readerTypography)}`);
  }
  if (await page.getByRole("navigation", { name: "二级标题快速导航" }).getByRole("button").count() !== 2) {
    throw new Error("Reader 目录圆点没有严格对应二级标题");
  }
  await selectReaderText(page, " with the heart ");
  await page.getByText("用心去看").waitFor();
  if (await providerInvocationCount() !== 1) {
    throw new Error("首次翻译没有产生且仅产生一次 Provider Invocation");
  }
  if (await page.getByText("当前语境", { exact: true }).count() > 0) {
    throw new Error("翻译气泡仍展示了冗余语境区");
  }
  if (await page.getByRole("button", { name: /关闭翻译|添加标注|发音/ }).count() > 0) {
    throw new Error("翻译气泡仍展示关闭、标注或声音入口");
  }
  if (await page.locator(".renderer-highlight-marker").count() > 0) {
    throw new Error("Reader 仍在段落末尾渲染高亮 marker");
  }
  const readerLayerOrder = await page.evaluate(() => {
    const lens = document.querySelector(".translation-lens");
    const outline = document.querySelector(".reader-outline-rail");
    const progress = document.querySelector(".reader-progressbar");
    const topbar = document.querySelector(".reader-topbar");
    if (lens === null || outline === null || progress === null || topbar === null) {
      throw new Error("Reader 层级元素不完整");
    }
    return {
      lens: Number.parseInt(getComputedStyle(lens).zIndex, 10),
      outline: Number.parseInt(getComputedStyle(outline).zIndex, 10),
      progress: Number.parseInt(getComputedStyle(progress).zIndex, 10),
      topbar: Number.parseInt(getComputedStyle(topbar).zIndex, 10),
    };
  });
  if (!(
    readerLayerOrder.lens < readerLayerOrder.outline
    && readerLayerOrder.outline < readerLayerOrder.progress
    && readerLayerOrder.progress < readerLayerOrder.topbar
  )) {
    throw new Error("翻译气泡必须位于正文之上，但低于目录、进度栏和顶部 Header");
  }
  const anchoredBeforeScroll = await page.evaluate(() => {
    const lens = document.querySelector(".translation-lens");
    const highlight = document.querySelector(".translation-text-highlight");
    if (lens === null || highlight === null) throw new Error("翻译气泡或原词高亮不存在");
    return {
      lensTop: lens.getBoundingClientRect().top,
      highlightTop: highlight.getBoundingClientRect().top,
      scrollY: window.scrollY,
    };
  });
  await page.evaluate(() => window.scrollBy(0, Math.min(80, document.documentElement.scrollHeight - window.innerHeight)));
  const anchoredAfterScroll = await page.evaluate(() => {
    const lens = document.querySelector(".translation-lens");
    const highlight = document.querySelector(".translation-text-highlight");
    if (lens === null || highlight === null) throw new Error("页面滚动后翻译气泡被关闭");
    lens.scrollTop = 20;
    lens.dispatchEvent(new Event("scroll", { bubbles: true }));
    return {
      lensTop: lens.getBoundingClientRect().top,
      highlightTop: highlight.getBoundingClientRect().top,
      scrollY: window.scrollY,
    };
  });
  const scrollDelta = anchoredAfterScroll.scrollY - anchoredBeforeScroll.scrollY;
  if (
    scrollDelta > 0
    && (
      Math.abs((anchoredAfterScroll.lensTop - anchoredBeforeScroll.lensTop) + scrollDelta) > 2
      || Math.abs((anchoredAfterScroll.highlightTop - anchoredBeforeScroll.highlightTop) + scrollDelta) > 2
    )
  ) {
    throw new Error("翻译气泡没有按原词的相对位置实时跟随页面滚动");
  }
  await page.locator(".translation-lens").waitFor({ state: "visible" });
  await page.locator(".reader-progressbar").click();
  await page.locator(".translation-lens").waitFor({ state: "hidden" });
  await page.reload();
  const translatedText = page.locator(".translation-text-highlight");
  await translatedText.waitFor();
  if (await translatedText.textContent() !== "with the heart") {
    throw new Error("已翻译下划线没有裁剪选区左右空格");
  }
  await translatedText.click();
  await page.getByText("用心去看").waitFor();
  if (await providerInvocationCount() !== 1) {
    throw new Error("点击历史翻译文字不应触发 Provider Invocation");
  }
  const retryResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST" && response.url().endsWith("/retry")
  ));
  await page.getByRole("button", { name: "重新翻译" }).click();
  const retryResponse = await retryResponsePromise;
  if (!retryResponse.ok()) {
    throw new Error(`重新翻译请求失败：HTTP ${retryResponse.status()} ${await retryResponse.text()}`);
  }
  await waitForProviderInvocationCount(2);
  await page.getByRole("button", { name: "重新翻译" }).waitFor();
  await page.getByRole("button", { name: /收藏表达/ }).click();
  await page.getByRole("button", { name: /已收藏/ }).waitFor();
  await page.reload();
  await page.locator(".translation-text-highlight").waitFor();
  if (await page.locator(".recall-text-highlight").count() > 0) {
    throw new Error("已翻译原文范围仍同时触发 Recall 高亮");
  }
  await page.locator(".translation-text-highlight").click();
  await page.getByText("用心去看").waitFor();
  await page.getByRole("button", { name: "引用到 Workspace" }).click();
  await page.getByText("翻译：with the heart").waitFor();
  await page.getByLabel("基于这些材料提问").fill("这处表达在当前语境中强调什么？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await page.getByText("这处表达强调理解不能脱离当前阅读语境。", { exact: true }).waitFor();
  await waitForProviderInvocationCount(3);
  const workspaceBeforeDrag = await page.locator(".workspace-panel").boundingBox();
  if (workspaceBeforeDrag === null) throw new Error("Workspace 面板不可见，无法验证拖动");
  await page.locator(".workspace-header").hover();
  await page.mouse.down();
  await page.mouse.move(workspaceBeforeDrag.x - 70, workspaceBeforeDrag.y + 70);
  await page.mouse.up();
  const workspaceAfterDrag = await page.locator(".workspace-panel").boundingBox();
  if (workspaceAfterDrag === null || workspaceAfterDrag.x === workspaceBeforeDrag.x) {
    throw new Error("Workspace 拖动后位置没有变化");
  }
  const scrollBeforeMinimize = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "最小化工作区" }).click();
  await page.locator(".workspace-panel.is-minimized").waitFor();
  if (await page.evaluate(() => window.scrollY) !== scrollBeforeMinimize) {
    throw new Error("最小化 Workspace 改变了阅读位置");
  }
  await page.getByRole("button", { name: "展开工作区" }).click();
  await page.getByRole("button", { name: "关闭工作区" }).click();
  await page.getByRole("button", { name: "AI 工作区" }).click();
  await page.getByText("这处表达强调理解不能脱离当前阅读语境。", { exact: true }).waitFor();
  await page.goto("http://127.0.0.1:4411/learning");
  await page.getByRole("link", { name: "打开表达档案" }).click();
  await page.getByRole("heading", { name: "with the heart", exact: true }).waitFor();
  await page.getByText("First Reading", { exact: true }).waitFor();
  await page.getByPlaceholder("记录辨析、记忆线索或自己的理解…").fill("关注 heart 的隐喻用法");
  await page.getByRole("button", { name: "保存表达笔记" }).click();
  await page.getByRole("combobox", { name: "学习状态" }).click();
  await page.getByRole("option", { name: "已熟悉" }).click();
  await page.getByRole("combobox", { name: "学习状态" }).click();
  await page.getByRole("option", { name: "学习中" }).click();
  await page.getByRole("link", { name: "回到精确原文" }).click();
  await page.waitForSelector(".markdown-reader");
  if (!page.url().includes("revisionId=") || !page.url().includes("block=")) {
    throw new Error("表达详情没有使用 Revision 与 Semantic Range 返回原文");
  }
  await selectReaderText(page, "We learn");
  await waitForProviderInvocationCount(4);
  await selectReaderText(page, "appearances");
  await waitForProviderInvocationCount(5);
  await page.getByText("表象", { exact: true }).waitFor();
  await page.waitForTimeout(400);
  if (await page.getByText("我们学会", { exact: true }).count() > 0) {
    throw new Error("过期翻译结果覆盖了最新选区 Bubble");
  }
  await stop(localService);
  startLocalService();
  await waitFor("http://127.0.0.1:4430/api/health");
  await page.goto("http://127.0.0.1:4411/");
  await page.setInputFiles('input[type="file"]', {
    name: "Second Reading.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Second Reading\n\nAgain, we must see WITH THE HEART when facts are incomplete."),
  });
  await page.getByRole("button", { name: "导入文档" }).click();
  await page.locator(".library-document-card", { hasText: "Second Reading.md" }).getByRole("link").first().click();
  await page.getByRole("button", { name: /回忆表达：WITH THE HEART/i }).waitFor();
  await page.getByRole("button", { name: /回忆表达：WITH THE HEART/i }).click();
  await page.getByLabel("先写下你在当前语境中的理解").fill("不是只看表面，而是用心体会。");
  await page.getByRole("button", { name: "提交我的理解" }).click();
  await page.getByText("理解准确").waitFor();
  await browser.close();
  console.log("E2E_SMOKE_OK");
}

try {
  await main();
} finally {
  for (const child of processes.reverse()) await stop(child);
  await rm(dataDirectory, { recursive: true, force: true });
}
