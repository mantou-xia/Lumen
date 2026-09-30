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

async function readerTextPoint(page, selector, selectedText, characterIndex = 0) {
  return page.locator(selector, { hasText: selectedText }).first().evaluate((element, input) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let fullText = "";
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      nodes.push({ node, start: fullText.length, end: fullText.length + node.textContent.length });
      fullText += node.textContent;
    }
    const start = fullText.indexOf(input.selectedText) + input.characterIndex;
    const segment = nodes.find((item) => item.start <= start && item.end > start);
    if (start < input.characterIndex || segment === undefined) throw new Error(`Reader 中找不到定位文本：${input.selectedText}`);
    const range = document.createRange();
    range.setStart(segment.node, start - segment.start);
    range.setEnd(segment.node, start - segment.start + 1);
    const bounds = range.getBoundingClientRect();
    return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
  }, { selectedText, characterIndex });
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
  const themeChoiceLayout = await page.locator(".theme-choice").first().evaluate((element) => ({
    display: getComputedStyle(element).display,
    previewVisible: element.querySelector(".theme-preview")?.getBoundingClientRect().height > 0,
  }));
  if (themeChoiceLayout.display !== "grid" || !themeChoiceLayout.previewVisible) {
    throw new Error(`主题卡片没有恢复为完整预览布局：${JSON.stringify(themeChoiceLayout)}`);
  }
  const firstSwitch = page.locator(".toggle-row .MuiSwitch-root").first();
  const firstSwitchInput = firstSwitch.locator('input[type="checkbox"]');
  if (!await firstSwitchInput.isChecked()) await firstSwitchInput.click();
  const checkedSwitchColors = await firstSwitch.evaluate((element) => ({
    thumb: getComputedStyle(element.querySelector(".MuiSwitch-thumb")).backgroundColor,
    track: getComputedStyle(element.querySelector(".MuiSwitch-track")).backgroundColor,
  }));
  if (checkedSwitchColors.thumb === checkedSwitchColors.track) {
    throw new Error(`开启状态的 Switch 滑块与轨道仍为同色：${JSON.stringify(checkedSwitchColors)}`);
  }
  await page.getByRole("button", { name: "手动代理" }).click();
  await page.getByLabel("代理端口").fill("9");
  await page.getByRole("button", { name: "保存网络设置" }).click();
  await page.getByText("网络线路设置已保存，并已用于后续外部资料请求。").waitFor();
  await page.getByText("手动代理端口当前不可连接；保持手动模式时，外部资料请求会失败。").waitFor();
  await page.locator(".theme-choice--sepia").click();
  await page.locator('html[data-theme="sepia"]').waitFor();
  await page.getByRole("button", { name: "840px" }).click();
  await page.getByRole("button", { name: "20px" }).click();
  const colorControls = page.locator(".rgb-color-control");
  await colorControls.nth(0).getByLabel("R").fill("12");
  await colorControls.nth(0).getByLabel("G").fill("34");
  await colorControls.nth(0).getByLabel("B").fill("56");
  await colorControls.nth(1).getByLabel("R").fill("78");
  await colorControls.nth(1).getByLabel("G").fill("90");
  await colorControls.nth(1).getByLabel("B").fill("123");
  await page.goto("http://127.0.0.1:4411/");
  await page.locator('html[data-theme="sepia"]').waitFor();
  const logoStates = await page.locator(".library-brand img").evaluateAll((images) => images.map((image) => ({
    className: image.className,
    loaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
  })));
  if (
    !logoStates.some((logo) => logo.className.includes("library-brand-symbol") && logo.loaded)
    || !logoStates.some((logo) => logo.className.includes("library-brand-wordmark") && logo.loaded)
  ) {
    throw new Error(`Lumen 图形与文字 Logo 未完整加载：${JSON.stringify(logoStates)}`);
  }
  if (await page.locator(".library-brand", { hasText: "本地阅读" }).count() > 0) {
    throw new Error("侧边栏品牌区仍展示“本地阅读”文案");
  }
  const wordmarkRatio = await page.locator(".library-brand-wordmark").evaluate((image) => (
    image instanceof HTMLImageElement ? image.naturalWidth / image.naturalHeight : 0
  ));
  if (wordmarkRatio < 4) {
    throw new Error(`文字 Logo 两侧留白仍然过大：宽高比 ${wordmarkRatio}`);
  }
  const sidebarToggle = page.getByRole("button", { name: "收起侧边栏" });
  const toggleBeforeNavigation = await sidebarToggle.evaluate((button) => {
    const navigation = document.querySelector(".library-navigation");
    return navigation !== null && Boolean(button.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  if (!toggleBeforeNavigation) throw new Error("收起侧边栏按钮没有放在主导航上方");
  const toggleAlignment = await sidebarToggle.evaluate((button) => getComputedStyle(button).justifyContent);
  if (toggleAlignment !== "center") {
    throw new Error(`收起侧边栏按钮没有保持水平居中：${toggleAlignment}`);
  }
  const sidebar = page.locator(".library-sidebar");
  const expandedSidebarWidth = (await sidebar.boundingBox())?.width ?? 0;
  await sidebarToggle.click();
  await page.waitForTimeout(80);
  const transitioningSidebarWidth = (await sidebar.boundingBox())?.width ?? 0;
  await page.waitForTimeout(260);
  const collapsedSidebarWidth = (await sidebar.boundingBox())?.width ?? 0;
  if (
    transitioningSidebarWidth >= expandedSidebarWidth
    || transitioningSidebarWidth <= collapsedSidebarWidth
    || collapsedSidebarWidth >= expandedSidebarWidth
  ) {
    throw new Error(`侧边栏折叠没有形成平滑宽度过渡：${JSON.stringify({ expandedSidebarWidth, transitioningSidebarWidth, collapsedSidebarWidth })}`);
  }
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await page.waitForTimeout(300);
  await page.locator('.library-page-heading input[type="file"]').setInputFiles({
    name: "First Reading.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# First Reading\n\n## Seeing clearly\n\nWe learn to see with the heart when appearances are misleading.\n\n| Feature | ANNoy | HNSW |\n| :-- | --: | :--: |\n| Build speed | Fast | Slower |\n| Accuracy | ~~Medium~~ | **High** |\n\n- [x] Parsed as a task\n- [ ] Still readable\n\n```js\nconst context = 'document';\n```\n\nReading closely requires enough space for attention, comparison, and reflection. This paragraph keeps the document long enough to verify live reading progress.\n\nA second supporting paragraph gives the viewport another semantic block to cross while the reader scrolls.\n\n### A smaller idea\n\nDetails support the chapter.\n\nSmall observations become useful when they remain connected to the surrounding argument and the reader's current purpose.\n\n## Continuing\n\nThe next chapter keeps the reading moving.\n\nLater paragraphs provide a clear destination near the bottom of the document so progress can change without leaving the Reader.\n\nThe final paragraph closes this smoke-test document after enough vertical distance for scrolling."),
  });
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
  await page.locator(".markdown-reader table").waitFor();
  if (await page.locator(".markdown-reader table tbody tr").count() !== 2) {
    throw new Error("Markdown GFM 表格没有渲染为正确的表格行");
  }
  const gfmTableAlignment = await page.locator(".markdown-reader table thead th").evaluateAll((cells) => (
    cells.map((cell) => getComputedStyle(cell).textAlign)
  ));
  if (JSON.stringify(gfmTableAlignment) !== JSON.stringify(["left", "right", "center"])) {
    throw new Error(`Markdown GFM 表格列对齐没有生效：${JSON.stringify(gfmTableAlignment)}`);
  }
  if (await page.locator('.markdown-reader input[type="checkbox"]').count() !== 2) {
    throw new Error("Markdown GFM 任务列表没有渲染为 checkbox");
  }
  const initialProgress = Number.parseInt(await page.locator(".reader-progressbar strong").innerText(), 10);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction((previousProgress) => {
    const value = Number.parseInt(document.querySelector(".reader-progressbar strong")?.textContent ?? "0", 10);
    return value > previousProgress;
  }, initialProgress);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "目录", exact: true }).click();
  const outlineTree = page.getByRole("tree", { name: "文档目录树" });
  await outlineTree.waitFor();
  const expandableOutline = outlineTree.getByRole("treeitem").first();
  const outlineCountBeforeCollapse = await outlineTree.getByRole("treeitem").count();
  await expandableOutline.locator(".outline-toggle").click();
  const outlineCountAfterCollapse = await outlineTree.getByRole("treeitem").count();
  if (outlineCountAfterCollapse >= outlineCountBeforeCollapse) {
    throw new Error("文档目录点击收起后，子级导航仍然全部可见");
  }
  await expandableOutline.locator(".outline-toggle").click();
  if (await outlineTree.getByRole("treeitem").count() !== outlineCountBeforeCollapse) {
    throw new Error("文档目录重新展开后，没有恢复完整树形导航");
  }
  await page.getByRole("button", { name: "关闭目录" }).click();
  const readerUrlBeforeSettings = new URL(page.url());
  await page.getByRole("link", { name: "阅读设置" }).click();
  await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
  const returnReadingLink = page.getByRole("link", { name: "返回阅读" });
  await returnReadingLink.waitFor();
  const expectedReturnPath = `${readerUrlBeforeSettings.pathname}${readerUrlBeforeSettings.search}`;
  const actualReturnUrl = new URL(await returnReadingLink.getAttribute("href"), page.url());
  if (`${actualReturnUrl.pathname}${actualReturnUrl.search}` !== expectedReturnPath) {
    throw new Error(`设置页返回地址没有保留原阅读位置：${actualReturnUrl.href}`);
  }
  await returnReadingLink.click();
  await page.waitForSelector(".markdown-reader");
  const defaultCursor = await page.locator("body").evaluate((element) => getComputedStyle(element).cursor);
  if (!defaultCursor.includes("data:image/svg+xml")) {
    throw new Error(`产品默认鼠标指针没有应用指定资源：${defaultCursor}`);
  }
  const assistantTrigger = page.getByRole("button", { name: "打开 AI 阅读助手" });
  await assistantTrigger.waitFor();
  await assistantTrigger.click();
  await page.getByRole("complementary", { name: "AI 阅读助手" }).waitFor();
  await page.getByRole("button", { name: "框选原文" }).click();
  const referencePoint = await readerTextPoint(page, '[data-block-type="paragraph"]', "appearances", 2);
  await page.mouse.move(referencePoint.x, referencePoint.y);
  await page.locator(".reference-preview--word").waitFor();
  await page.mouse.click(referencePoint.x, referencePoint.y);
  await page.getByText("单词：appearances", { exact: true }).waitFor();
  await page.getByRole("button", { name: "框选原文" }).waitFor();
  const capturedReferenceAssistant = page.getByRole("complementary", { name: "AI 阅读助手" });
  await capturedReferenceAssistant.getByRole("textbox").fill("这处主动框选引用了什么？");
  await capturedReferenceAssistant.getByRole("button", { name: "发送", exact: true }).click();
  await waitForProviderInvocationCount(1);
  await capturedReferenceAssistant.locator(".workspace-question", { hasText: "这处主动框选引用了什么？" }).waitFor();
  await capturedReferenceAssistant.getByText("选区：appearances", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭 AI 阅读助手" }).click();

  await page.getByRole("link", { name: "阅读设置" }).click();
  await page.getByRole("button", { name: "连续引用" }).click();
  await page.getByRole("link", { name: "返回阅读" }).click();
  await page.waitForSelector(".markdown-reader");
  await page.getByRole("button", { name: "打开 AI 阅读助手" }).click();
  await page.getByRole("button", { name: "框选原文" }).click();
  const continuousFirstPoint = await readerTextPoint(page, '[data-block-type="paragraph"]', "appearances", 2);
  await page.mouse.click(continuousFirstPoint.x, continuousFirstPoint.y);
  await page.getByText("单词：appearances", { exact: true }).waitFor();
  await page.getByText(/正在框选/).waitFor();
  const continuousSecondPoint = await readerTextPoint(page, '[data-block-type="paragraph"]', "misleading", 2);
  await page.mouse.click(continuousSecondPoint.x, continuousSecondPoint.y);
  await page.getByText("单词：misleading", { exact: true }).waitFor();
  await page.getByText(/正在框选/).waitFor();
  await page.keyboard.press("Escape");
  await page.getByText(/正在框选/).waitFor({ state: "hidden" });
  if (await page.locator(".workspace-panel").count() !== 1) {
    throw new Error("连续框选按 Esc 结束时不应关闭 AI 阅读助手");
  }
  await page.getByRole("button", { name: "移除 单词：appearances" }).click();
  await page.getByRole("button", { name: "移除 单词：misleading" }).click();
  await page.getByRole("button", { name: "关闭 AI 阅读助手" }).click();

  await selectReaderText(page, " with the heart ");
  await page.getByText("用心去看").waitFor();
  if (await providerInvocationCount() !== 2) {
    throw new Error("首次翻译没有产生且仅产生一次 Provider Invocation");
  }
  const translationUnderlineColor = await page.locator(".translation-assist-text-highlight").first().evaluate((element) => (
    getComputedStyle(element).textDecorationColor
  ));
  if (translationUnderlineColor !== "rgb(12, 34, 56)") {
    throw new Error(`翻译下划线没有应用持久化 RGB 偏好：${translationUnderlineColor}`);
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
    const highlight = document.querySelector(".translation-assist-text-highlight");
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
    const highlight = document.querySelector(".translation-assist-text-highlight");
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
  const translatedText = page.locator(".translation-assist-text-highlight");
  await translatedText.waitFor();
  if (await translatedText.textContent() !== "with the heart") {
    throw new Error("已翻译下划线没有裁剪选区左右空格");
  }
  await translatedText.click();
  await page.getByText("用心去看").waitFor();
  if (await providerInvocationCount() !== 2) {
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
  await waitForProviderInvocationCount(3);
  await page.getByRole("button", { name: "重新翻译" }).waitFor();
  await page.getByRole("button", { name: /收藏表达/ }).click();
  await page.getByRole("button", { name: /已收藏/ }).waitFor();
  await page.reload();
  await page.locator(".translation-assist-text-highlight").waitFor();
  if (await page.locator(".recall-text-highlight").count() > 0) {
    throw new Error("已翻译原文范围仍同时触发 Recall 高亮");
  }
  await page.locator(".translation-assist-text-highlight").click();
  await page.getByText("用心去看").waitFor();
  await page.getByRole("button", { name: "引用到 Workspace" }).click();
  const assistant = page.getByRole("complementary", { name: "AI 阅读助手" });
  await assistant.getByText("with the heart", { exact: true }).waitFor();
  await assistant.getByPlaceholder(/留空直接解释/).fill("这处表达在当前语境中强调什么？");
  await assistant.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("这处表达强调理解不能脱离当前阅读语境。", { exact: false }).waitFor();
  await waitForProviderInvocationCount(4);
  const contextualQuestionTurn = assistant.locator(".workspace-turn", { hasText: "这处表达在当前语境中强调什么？" });
  await contextualQuestionTurn.getByRole("button", { name: "查看来源" }).click();
  await page.locator('.annotation-text-highlight[data-highlight-id="workspace-citation-source"]').waitFor();
  await contextualQuestionTurn.getByRole("button", { name: "引用本轮对话" }).click();
  await page.getByText("历史问答：这处表达在当前语境中强调什么？", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭 AI 阅读助手" }).click();
  await page.getByRole("button", { name: "打开 AI 阅读助手" }).click();
  await contextualQuestionTurn.getByText("这处表达强调理解不能脱离当前阅读语境。", { exact: false }).waitFor();
  await page.getByRole("button", { name: "关闭 AI 阅读助手" }).click();
  await page.goto("http://127.0.0.1:4411/learning");
  const learningSearch = page.getByRole("searchbox", { name: "搜索表达" });
  await learningSearch.waitFor();
  if (await page.locator("label.learning-search").count() > 0 || !await learningSearch.locator("xpath=..").evaluate((element) => element.classList.contains("MuiOutlinedInput-root"))) {
    throw new Error("表达搜索仍是 Label 套输入框，而不是单一的 MUI 搜索框");
  }
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
  await waitForProviderInvocationCount(5);
  await selectReaderText(page, "appearances");
  await waitForProviderInvocationCount(6);
  await page.getByText("表象", { exact: true }).waitFor();
  await page.waitForTimeout(400);
  if (await page.getByText("我们学会", { exact: true }).count() > 0) {
    throw new Error("过期翻译结果覆盖了最新选区 Bubble");
  }
  await page.getByRole("button", { name: "打开 AI 阅读助手" }).click();
  await assistant.getByText("appearances", { exact: true }).waitFor();
  await assistant.getByRole("button", { name: "解释选中内容" }).click();
  await waitForProviderInvocationCount(7);
  await assistant.getByText(/已生成解释标记/).waitFor();
  await page.getByRole("button", { name: "关闭 AI 阅读助手" }).click();
  await page.locator(".translation-assist-text-highlight", { hasText: "appearances" }).click();
  await page.getByRole("button", { name: "查看解释" }).click();
  await page.locator(".explanation-lens").waitFor();
  await page.getByRole("button", { name: "继续追问" }).click();
  await assistant.locator(".workspace-question", { hasText: /解释.*appearances/ }).waitFor();
  await assistant.getByPlaceholder(/询问当前材料/).fill("第一篇专属问题是什么？");
  await assistant.getByRole("button", { name: "发送", exact: true }).click();
  await waitForProviderInvocationCount(8);
  await assistant.locator(".workspace-question", { hasText: "第一篇专属问题是什么？" }).waitFor();
  await page.getByRole("button", { name: "关闭 AI 阅读助手" }).click();
  await page.reload();
  await page.waitForSelector(".markdown-reader");
  await page.getByRole("button", { name: "打开 AI 阅读助手" }).click();
  await page.locator(".workspace-question", { hasText: "第一篇专属问题是什么？" }).waitFor();
  await page.getByRole("button", { name: "关闭 AI 阅读助手" }).click();
  await stop(localService);
  startLocalService();
  await waitFor("http://127.0.0.1:4430/api/health");
  await page.goto("http://127.0.0.1:4411/");
  await page.locator('.library-page-heading input[type="file"]').setInputFiles({
    name: "Second Reading.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Second Reading\n\nAgain, we must see WITH THE HEART when facts are incomplete."),
  });
  await page.locator(".library-document-card", { hasText: "Second Reading.md" }).getByRole("link").first().click();
  await page.getByRole("button", { name: /回忆表达：WITH THE HEART/i }).waitFor();
  await page.getByRole("button", { name: /回忆表达：WITH THE HEART/i }).click();
  await page.getByLabel("先写下你在当前语境中的理解").fill("不是只看表面，而是用心体会。");
  await page.getByRole("button", { name: "提交我的理解" }).click();
  await page.getByText("理解准确").waitFor();
  await page.goto("http://127.0.0.1:4411/");
  await page.getByRole("button", { name: "创建 Book", exact: true }).click();
  const createBookDialog = page.getByRole("dialog");
  await createBookDialog.getByLabel("Book 标题").fill("Smoke Book");
  await createBookDialog.getByLabel("First Reading").check();
  await createBookDialog.getByLabel("Second Reading").check();
  await createBookDialog.getByRole("button", { name: "创建 Book" }).click();
  const bookCard = page.locator(".library-book-card", { hasText: "Smoke Book" });
  await bookCard.waitFor();
  await bookCard.getByRole("button", { name: "调整 Page 顺序" }).click();
  const orderDialog = page.getByRole("dialog");
  await orderDialog.getByRole("button", { name: "上移 First Reading" }).click();
  await orderDialog.getByRole("button", { name: "保存顺序" }).click();
  await bookCard.getByRole("link").first().click();
  await page.waitForSelector(".markdown-reader");
  await page.getByText("First Reading", { exact: true }).first().waitFor();
  const readerShellBeforePageSwitch = await page.locator(".immersive-reader").count();
  await page.getByRole("button", { name: "下一页" }).click();
  if (readerShellBeforePageSwitch !== 1 || await page.locator(".immersive-reader").count() !== 1) {
    throw new Error("Book Page 切换期间 Reader Shell 被卸载");
  }
  await page.getByText("Second Reading", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "打开 AI 阅读助手" }).click();
  if (await page.locator(".workspace-question", { hasText: "第一篇专属问题是什么？" }).count() > 0) {
    throw new Error("Book Reader 的 AI 阅读助手把 First Reading 对话泄漏到了 Second Reading");
  }
  await page.getByRole("button", { name: "关闭 AI 阅读助手" }).click();
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("navigation", { name: "Book Page 列表" }).getByRole("button", { name: /First Reading/ }).click();
  await page.getByText("First Reading", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "打开 AI 阅读助手" }).click();
  await page.locator(".workspace-question", { hasText: "第一篇专属问题是什么？" }).waitFor();
  await page.getByRole("button", { name: "关闭 AI 阅读助手" }).click();
  if (!page.url().includes("/reader/books/") || !page.url().includes("pageId=")) {
    throw new Error(`Book Reader 没有保持 Book 路由与 Page 身份：${page.url()}`);
  }
  await page.goto("http://127.0.0.1:4411/");
  await page.getByRole("button", { name: "技术学习" }).click();
  await page.locator('.library-page-heading input[type="file"]').setInputFiles({
    name: "Technical Learning.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Technical Learning\n\nREST uses resources and standard HTTP semantics."),
  });
  await page.locator(".library-document-card", { hasText: "Technical Learning.md" }).getByRole("link").first().click();
  await page.locator(".reader-scene-badge", { hasText: "技术学习" }).waitFor();
  const technicalInvocationBaseline = await providerInvocationCount();
  await selectReaderText(page, "REST");
  await page.locator(".technical-selection-actions").waitFor();
  await page.waitForTimeout(200);
  if (await providerInvocationCount() !== technicalInvocationBaseline) throw new Error("技术学习普通选区不应自动调用模型");
  await page.getByRole("button", { name: "解释", exact: true }).click();
  await waitForProviderInvocationCount(technicalInvocationBaseline + 1);
  await page.locator(".explanation-lens").waitFor();
  const explanationUnderlineColor = await page.locator(".explanation-assist-text-highlight").first().evaluate((element) => (
    getComputedStyle(element).textDecorationColor
  ));
  if (explanationUnderlineColor !== "rgb(78, 90, 123)") {
    throw new Error(`解释下划线没有应用持久化 RGB 偏好：${explanationUnderlineColor}`);
  }
  await page.locator(".reader-progressbar").click();
  await selectReaderText(page, "REST");
  await page.getByRole("button", { name: "翻译", exact: true }).click();
  await waitForProviderInvocationCount(technicalInvocationBaseline + 2);
  await page.locator(".translation-lens").waitFor();
  await page.getByRole("button", { name: "查看解释" }).click();
  await page.locator(".explanation-lens").waitFor();
  await page.getByRole("button", { name: "查看翻译" }).click();
  await page.locator(".translation-lens").waitFor();
  if (await providerInvocationCount() !== technicalInvocationBaseline + 2) throw new Error("同范围翻译与解释互相打开不应重复调用模型");
  await page.locator(".reader-progressbar").click();
  await selectReaderText(page, "resources");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  const technicalAssistant = page.getByRole("complementary", { name: "AI 阅读助手" });
  await technicalAssistant.getByText("resources", { exact: true }).waitFor();
  if (await providerInvocationCount() !== technicalInvocationBaseline + 2) throw new Error("技术学习提问入口打开面板时不应自动调用模型");
  await technicalAssistant.getByPlaceholder(/留空直接解释/).fill("它在这里表示什么？");
  await technicalAssistant.getByRole("button", { name: "发送", exact: true }).click();
  await waitForProviderInvocationCount(technicalInvocationBaseline + 3);
  await technicalAssistant.locator(".workspace-question", { hasText: "它在这里表示什么？" }).waitFor();
  await browser.close();
  console.log("E2E_SMOKE_OK");
}

try {
  await main();
} finally {
  for (const child of processes.reverse()) await stop(child);
  await rm(dataDirectory, { recursive: true, force: true });
}
