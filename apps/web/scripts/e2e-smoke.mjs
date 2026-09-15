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
  if (await page.locator(".library-workspace-bar").count() > 0) {
    throw new Error("设置页仍显示顶部工作区栏");
  }
  const settingsNavigation = page.getByRole("navigation", { name: "设置分区" });
  const activeSettingsLink = () => settingsNavigation.locator('a[aria-current="location"]');
  if (await activeSettingsLink().innerText() !== "阅读外观") {
    throw new Error("设置页首次打开时没有选中阅读外观");
  }
  await settingsNavigation.getByRole("link", { name: "阅读交互", exact: true }).click();
  await page.waitForTimeout(700);
  const interactionNavigationState = await page.locator("#interaction").evaluate((section) => ({
    activeLabel: document.querySelector('.settings-section-nav a[aria-current="location"]')?.textContent?.trim(),
    hash: window.location.hash,
    top: Math.round(section.getBoundingClientRect().top),
  }));
  if (
    interactionNavigationState.activeLabel !== "阅读交互"
    || interactionNavigationState.hash !== "#interaction"
    || Math.abs(interactionNavigationState.top - 86) > 14
  ) {
    throw new Error(`设置分区点击没有同步定位与高亮：${JSON.stringify(interactionNavigationState)}`);
  }
  await page.locator(".library-main").evaluate((scrollRoot) => {
    const providerSection = scrollRoot.querySelector("#provider");
    if (!(providerSection instanceof HTMLElement)) throw new Error("缺少 AI Provider 设置分区");
    const rootTop = scrollRoot.getBoundingClientRect().top;
    scrollRoot.scrollTo({
      behavior: "instant",
      top: scrollRoot.scrollTop + providerSection.getBoundingClientRect().top - rootTop - 86,
    });
  });
  await page.waitForFunction(() => (
    document.querySelector('.settings-section-nav a[aria-current="location"]')?.textContent?.trim() === "AI Provider"
  ));
  await page.locator(".library-main").evaluate((scrollRoot) => {
    scrollRoot.scrollTo({ behavior: "instant", top: scrollRoot.scrollHeight });
  });
  await page.waitForFunction(() => (
    document.querySelector('.settings-section-nav a[aria-current="location"]')?.textContent?.trim() === "本地数据与隐私"
  ));
  await settingsNavigation.getByRole("link", { name: "阅读外观", exact: true }).click();
  await page.waitForTimeout(700);
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
  const disabledProtocolInputOpacity = await page
    .locator(".network-proxy-fields input.MuiSelect-nativeInput")
    .evaluate((input) => getComputedStyle(input).opacity);
  if (disabledProtocolInputOpacity !== "0") {
    throw new Error(`代理协议的 MUI 隐藏输入被全局禁用态样式显示：opacity=${disabledProtocolInputOpacity}`);
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
  await page.goto("http://127.0.0.1:4411/");
  await page.locator('html[data-theme="sepia"]').waitFor();
  if (await page.locator(".library-workspace-bar").count() > 0) {
    throw new Error("文档库首页仍展示顶部工作区栏");
  }
  if (await page.locator(".library-page-heading .library-kicker").count() > 0) {
    throw new Error("文档库首页仍展示 Lumen Archive 标识行");
  }
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
    buffer: Buffer.from("# First Reading\n\n## Seeing clearly\n\nWe learn to see with the heart when appearances are misleading.\n\n> A quoted engineering note keeps its own block alignment.\n\n| Feature | ANNoy | HNSW |\n| :-- | --: | :--: |\n| Build speed | Fast | Slower |\n| Accuracy | ~~Medium~~ | **High** |\n\n- [x] Parsed as a task\n- [ ] Still readable\n\nReading closely requires enough space for attention, comparison, and reflection. This paragraph keeps the document long enough to verify live reading progress.\n\nA second supporting paragraph gives the viewport another semantic block to cross while the reader scrolls.\n\n### A smaller idea\n\nDetails support the chapter.\n\nSmall observations become useful when they remain connected to the surrounding argument and the reader's current purpose.\n\n## Continuing\n\nThe next chapter keeps the reading moving.\n\nLater paragraphs provide a clear destination near the bottom of the document so progress can change without leaving the Reader.\n\nA third paragraph leaves enough document below this chapter to verify that navigation can position the heading beneath the fixed Reader header.\n\nA fourth paragraph keeps the target away from the document's maximum scroll boundary so the navigation offset can be measured precisely.\n\nA fifth paragraph ensures a tall desktop viewport can still move the chapter heading to its requested navigation position.\n\nA sixth paragraph separates navigation correctness from the browser's maximum document scroll boundary.\n\nA seventh paragraph makes the fixture representative of a long technical chapter rather than a short end note.\n\nAn eighth paragraph preserves additional reading space after the heading for deterministic browser assertions.\n\nThe final paragraph closes this smoke-test document after enough vertical distance for scrolling."),
  });
  const firstDocumentCard = page.locator(".library-document-card", { hasText: "First Reading.md" });
  await firstDocumentCard.waitFor();
  const libraryCardLayout = await firstDocumentCard.evaluate((card) => {
    const grid = card.closest(".library-document-grid");
    const cover = card.querySelector(".library-document-cover");
    const details = card.querySelector(".library-document-details");
    if (grid === null || cover === null || details === null) {
      throw new Error("文档卡片结构不完整");
    }
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
      coverHeight: getComputedStyle(cover).height,
      detailsMinHeight: getComputedStyle(details).minHeight,
    };
  });
  if (
    libraryCardLayout.columns !== 3
    || libraryCardLayout.coverHeight !== "142px"
    || libraryCardLayout.detailsMinHeight !== "190px"
  ) {
    throw new Error(`文档卡片没有采用已确认的三列紧凑布局：${JSON.stringify(libraryCardLayout)}`);
  }
  await firstDocumentCard.getByRole("link").first().click();
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
  const paragraphLayout = await page.locator(".markdown-reader").evaluate((reader) => {
    const quoteParagraph = reader.querySelector("blockquote p");
    if (quoteParagraph === null) throw new Error("Markdown 引用段落没有渲染");
    return {
      bodyIndents: [...new Set(
        Array.from(
          reader.querySelectorAll(":scope > p"),
          (paragraph) => getComputedStyle(paragraph).textIndent,
        ),
      )],
      quoteIndent: getComputedStyle(quoteParagraph).textIndent,
    };
  });
  if (
    JSON.stringify(paragraphLayout.bodyIndents) !== JSON.stringify(["40px"])
    || paragraphLayout.quoteIndent !== "0px"
  ) {
    throw new Error(`Markdown 正文或引用段落缩进不符合要求：${JSON.stringify(paragraphLayout)}`);
  }
  const structuredContentLayout = await page.locator(".markdown-reader").evaluate((reader) => {
    const quote = reader.querySelector("blockquote");
    const tableScroll = reader.querySelector(".reader-table-scroll");
    const table = tableScroll?.querySelector("table");
    if (quote === null || tableScroll === null || table === null) {
      throw new Error("Markdown 引用或表格没有渲染");
    }
    const code = document.createElement("pre");
    code.className = "ui-scroll-area ui-scroll-area--x";
    code.innerHTML = "<code>const longReadableLine = 'This ordinary code line should wrap inside the wider reading surface without forcing page-level horizontal scrolling.';</code>";
    reader.append(code);
    const codeStyle = getComputedStyle(code);
    const codeHeaderStyle = getComputedStyle(code, "::before");
    const result = {
      codeHeaderHeight: codeHeaderStyle.height,
      codeOverflowWrap: codeStyle.overflowWrap,
      codeWhiteSpace: codeStyle.whiteSpace,
      codeWidth: code.getBoundingClientRect().width,
      quoteWidth: quote.getBoundingClientRect().width,
      readerWidth: reader.getBoundingClientRect().width,
      tableFitsDesktopSurface: table.scrollWidth <= tableScroll.clientWidth,
      tableLayout: getComputedStyle(table).tableLayout,
      tableWidth: tableScroll.getBoundingClientRect().width,
    };
    code.remove();
    return result;
  });
  if (
    structuredContentLayout.codeHeaderHeight !== "42px"
    || structuredContentLayout.codeOverflowWrap !== "anywhere"
    || structuredContentLayout.codeWhiteSpace !== "pre-wrap"
    || structuredContentLayout.codeWidth <= structuredContentLayout.readerWidth
    || structuredContentLayout.quoteWidth <= structuredContentLayout.readerWidth
    || structuredContentLayout.tableWidth <= structuredContentLayout.readerWidth
    || structuredContentLayout.tableLayout !== "fixed"
    || !structuredContentLayout.tableFitsDesktopSurface
  ) {
    throw new Error(`Markdown 结构化内容没有采用已确认的宽内容排版：${JSON.stringify(structuredContentLayout)}`);
  }
  if (await page.locator(".reader-topbar > .reader-progressbar").count() !== 1) {
    throw new Error("Reader 阅读进度没有并入顶部工作区");
  }
  const readerTools = page.getByRole("navigation", { name: "阅读工具" });
  if (
    await readerTools.getByRole("button", { name: "AI 工作区", exact: true }).count() > 0
    || await readerTools.getByRole("button", { name: "目录", exact: true }).count() > 0
  ) {
    throw new Error("Reader 顶部工作区仍展示 AI 工作区或目录入口");
  }
  if (await page.getByRole("button", { name: "打开文档目录" }).count() !== 1) {
    throw new Error("Reader 左侧没有保留唯一的完整目录入口");
  }
  await page.setViewportSize({ width: 760, height: 900 });
  const narrowReaderHeader = await page.locator(".reader-topbar").evaluate((header) => ({
    fitsViewport: header.scrollWidth <= header.clientWidth,
    pageFitsViewport: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    progressNoteHidden: getComputedStyle(header.querySelector(".reader-progressbar small")).display === "none",
    progressTrackVisible: header.querySelector(".reader-progressbar > span")?.getBoundingClientRect().width > 0,
  }));
  if (
    !narrowReaderHeader.fitsViewport
    || !narrowReaderHeader.pageFitsViewport
    || !narrowReaderHeader.progressNoteHidden
    || !narrowReaderHeader.progressTrackVisible
    || !await page.getByRole("link", { name: "阅读设置" }).isVisible()
  ) {
    throw new Error(`Reader 窄屏顶部工作区没有保持可用：${JSON.stringify(narrowReaderHeader)}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await page.getByRole("button", { name: "打开文档目录" }).click();
  const outlineTree = page.getByRole("tree", { name: "文档目录树" });
  await outlineTree.waitFor();
  const expandableOutline = outlineTree.getByRole("treeitem").first();
  const outlineCountBeforeCollapse = await outlineTree.getByRole("treeitem").count();
  await expandableOutline.locator(".outline-toggle").click();
  const outlineCountAfterCollapse = await outlineTree.getByRole("treeitem").count();
  if (outlineCountAfterCollapse >= outlineCountBeforeCollapse) {
    throw new Error("文档目录点击收起后，子级导航仍然全部可见");
  }
  await page.getByRole("button", { name: "关闭目录" }).click();
  await page.getByRole("button", { name: "打开文档目录" }).click();
  await outlineTree.waitFor();
  if (
    await outlineTree.getByRole("treeitem").count() !== outlineCountAfterCollapse
    || await outlineTree.getByRole("treeitem").first().getAttribute("aria-expanded") !== "false"
  ) {
    throw new Error("文档目录关闭后再次打开，没有保留用户上次的折叠状态");
  }
  await outlineTree.getByRole("treeitem").first().locator(".outline-toggle").click();
  if (await outlineTree.getByRole("treeitem").count() !== outlineCountBeforeCollapse) {
    throw new Error("文档目录重新展开后，没有恢复完整树形导航");
  }
  await page.getByRole("button", { name: "关闭目录" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const chapterDots = page.getByRole("navigation", { name: "二级标题快速导航" }).getByRole("button");
  const secondChapterDot = chapterDots.nth(1);
  await secondChapterDot.click();
  await page.waitForTimeout(700);
  const dotNavigationState = await page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll(".reader-outline-dots button"));
    const target = document.querySelector(".markdown-reader h2:nth-of-type(2)");
    const header = document.querySelector(".reader-topbar");
    if (target === null || header === null) throw new Error("章节导航目标或 Reader 顶部栏不存在");
    return {
      activeDotIndex: dots.findIndex((dot) => dot.classList.contains("is-active")),
      headerBottom: header.getBoundingClientRect().bottom,
      targetTop: target.getBoundingClientRect().top,
    };
  });
  if (dotNavigationState.activeDotIndex !== 1) {
    throw new Error(`章节圆点高亮没有对应用户点击的章节：${JSON.stringify(dotNavigationState)}`);
  }
  if (dotNavigationState.targetTop < dotNavigationState.headerBottom + 16) {
    throw new Error(`章节圆点导航目标被顶部栏遮挡：${JSON.stringify(dotNavigationState)}`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "打开文档目录" }).click();
  await outlineTree.waitFor();
  const continuingHeading = page.getByRole("heading", { name: "Continuing", exact: true });
  await outlineTree.getByRole("treeitem", { name: "Continuing", exact: true }).click();
  await page.waitForTimeout(700);
  const outlineNavigationPosition = await continuingHeading.evaluate((heading) => {
    const header = document.querySelector(".reader-topbar");
    if (header === null) throw new Error("Reader 顶部栏不存在");
    return {
      headerBottom: header.getBoundingClientRect().bottom,
      targetTop: heading.getBoundingClientRect().top,
    };
  });
  if (outlineNavigationPosition.targetTop < outlineNavigationPosition.headerBottom + 16) {
    throw new Error(`完整目录导航目标被顶部栏遮挡：${JSON.stringify(outlineNavigationPosition)}`);
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
  await page.getByRole("navigation", { name: "二级标题快速导航" }).getByRole("button").first().click();
  await page.waitForTimeout(700);
  await selectReaderText(page, " with the heart ");
  await page.getByText("用心去看").waitFor();
  await page.locator(".translation-text-highlight").waitFor();
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
  const translationLensLayout = await page.locator(".translation-lens").evaluate((lens) => {
    const body = lens.querySelector(".translation-lens-body");
    const actions = lens.querySelector(".translation-actions");
    if (body === null || actions === null) throw new Error("翻译卡片缺少独立正文区或操作区");
    const actionLabels = Array.from(actions.querySelectorAll("button"), (button) => (
      button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""
    ));
    return {
      actionColumns: getComputedStyle(actions).gridTemplateColumns.split(" ").filter(Boolean).length,
      actionLabels,
      bodyOverflowY: getComputedStyle(body).overflowY,
      lensOverflowY: getComputedStyle(lens).overflowY,
      width: getComputedStyle(lens).width,
    };
  });
  if (
    translationLensLayout.width !== "420px"
    || translationLensLayout.lensOverflowY !== "hidden"
    || translationLensLayout.bodyOverflowY !== "auto"
    || translationLensLayout.actionColumns !== 3
    || JSON.stringify(translationLensLayout.actionLabels) !== JSON.stringify([
      "收藏表达",
      "引用到 Workspace",
      "重新翻译",
    ])
    || await page.locator(".translation-lens details").count() > 0
  ) {
    throw new Error(`Translation Lens 没有采用已确认的紧凑卡片结构：${JSON.stringify(translationLensLayout)}`);
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
      topbar: Number.parseInt(getComputedStyle(topbar).zIndex, 10),
      progressInsideTopbar: topbar.contains(progress),
    };
  });
  if (!(
    readerLayerOrder.lens < readerLayerOrder.outline
    && readerLayerOrder.outline < readerLayerOrder.topbar
    && readerLayerOrder.progressInsideTopbar
  )) {
    throw new Error("翻译气泡必须低于目录和顶部 Header，且进度栏必须属于顶部 Header");
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
    const lensBody = document.querySelector(".translation-lens-body");
    const highlight = document.querySelector(".translation-text-highlight");
    if (lens === null || lensBody === null || highlight === null) throw new Error("页面滚动后翻译气泡被关闭或缺少正文滚动区");
    lensBody.scrollTop = 20;
    lensBody.dispatchEvent(new Event("scroll", { bubbles: true }));
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
  await page.locator(".translation-text-highlight").click();
  await page.getByText("用心去看").waitFor();
  await page.getByRole("button", { name: "引用到 Workspace" }).click();
  await page.getByText("这处表达强调理解不能脱离当前阅读语境。", { exact: true }).waitFor();
  await page.goto("http://127.0.0.1:4411/learning");
  const learningSearch = page.getByRole("searchbox", { name: "搜索表达" });
  await learningSearch.waitFor();
  const defaultLearningFilters = await Promise.all([
    page.getByRole("combobox", { name: "表达类型" }).innerText(),
    page.getByRole("combobox", { name: "学习状态" }).innerText(),
    page.getByRole("combobox", { name: "来源文档" }).innerText(),
  ]);
  if (defaultLearningFilters.join("|") !== "全部类型|进行中与已熟悉|全部来源") {
    throw new Error(`表达筛选没有显示默认值：${defaultLearningFilters.join("|")}`);
  }
  if (await page.locator(".library-workspace-bar").count() > 0) {
    throw new Error("表达收藏页仍显示顶部工作区栏");
  }
  if (await page.locator("label.learning-search").count() > 0 || !await learningSearch.locator("xpath=..").evaluate((element) => element.classList.contains("MuiOutlinedInput-root"))) {
    throw new Error("表达搜索仍是 Label 套输入框，而不是单一的 MUI 搜索框");
  }
  await page.getByRole("link", { name: "打开表达档案" }).click();
  await page.getByRole("heading", { name: "with the heart", exact: true }).waitFor();
  if (await page.locator(".library-workspace-bar").count() > 0) {
    throw new Error("表达详情页仍显示顶部工作区栏");
  }
  await page.getByText("First Reading", { exact: true }).waitFor();
  await page.waitForTimeout(300);
  if (await page.getByRole("button", { name: /(?:查看全部|收起)(?:原文|当时解释|不确定性)/ }).count() > 0) {
    throw new Error("真实语境仍显示查看全部或收起按钮");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const compactDetailLayout = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector(".expression-detail-layout")).gridTemplateColumns.split(" ").length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  if (compactDetailLayout.columns !== 1 || compactDetailLayout.overflow > 1) {
    throw new Error(`表达详情窄屏布局不正确：${JSON.stringify(compactDetailLayout)}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "编辑通用笔记" }).click();
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
  await page.getByRole("button", { name: "创建 Book" }).click();
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
  await page.getByRole("button", { name: "打开文档目录" }).click();
  const bookOutlineTree = page.getByRole("tree", { name: "文档目录树" });
  await bookOutlineTree.waitFor();
  await bookOutlineTree.getByRole("treeitem").first().locator(".outline-toggle").click();
  if (await bookOutlineTree.getByRole("treeitem").first().getAttribute("aria-expanded") !== "false") {
    throw new Error("Book 当前 Page 的目录节点没有按用户操作收起");
  }
  await page.getByRole("button", { name: "关闭目录" }).click();
  await page.getByRole("button", { name: "下一页" }).click();
  if (readerShellBeforePageSwitch !== 1 || await page.locator(".immersive-reader").count() !== 1) {
    throw new Error("Book Page 切换期间 Reader Shell 被卸载");
  }
  await page.getByText("Second Reading", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "打开文档目录" }).click();
  await page.getByRole("navigation", { name: "Book Page 列表" }).getByRole("button", { name: /First Reading/ }).click();
  await page.getByText("First Reading", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "打开文档目录" }).click();
  const restoredBookOutlineTree = page.getByRole("tree", { name: "文档目录树" });
  await restoredBookOutlineTree.waitFor();
  if (await restoredBookOutlineTree.getByRole("treeitem").first().getAttribute("aria-expanded") !== "true") {
    throw new Error("Book Page 切换后错误继承了上一 Page 的目录折叠状态");
  }
  if (!page.url().includes("/reader/books/") || !page.url().includes("pageId=")) {
    throw new Error(`Book Reader 没有保持 Book 路由与 Page 身份：${page.url()}`);
  }
  await browser.close();
  console.log("E2E_SMOKE_OK");
}

try {
  await main();
} finally {
  for (const child of processes.reverse()) await stop(child);
  await rm(dataDirectory, { recursive: true, force: true });
}
