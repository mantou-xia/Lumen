# Markdown Typography System

一个类似 Typora 的模块化 Markdown 渲染系统，将每个 Markdown 语法元素都映射为独立的 CSS 类，实现完全可定制的样式。

## 设计理念

参考 Typora 的设计，将 Markdown 的每个语法元素抽象为独立的 CSS 类：

- **模块化**：每个元素都有自己的类，可以单独定制
- **语义化**：类名清晰表达元素的作用
- **可组合**：通过组合类来实现复杂样式
- **主题支持**：通过 CSS 变量实现多主题切换

## 类名结构

所有类名都以 `md-` 为前缀（可自定义），遵循 BEM 命名规范：

```
md-{element}
md-{element}--{modifier}
md-{element}-{sub-element}
```

## 元素类名表

### 容器

- `.md-content` - Markdown 内容容器

### 标题

- `.md-heading` - 所有标题的基础类
- `.md-heading-1` - H1 标题
- `.md-heading-2` - H2 标题
- `.md-heading-3` - H3 标题
- `.md-heading-4` - H4 标题
- `.md-heading-5` - H5 标题
- `.md-heading-6` - H6 标题

### 段落

- `.md-paragraph` - 普通段落
- `.md-paragraph--indented` - 首行缩进段落
- `.md-paragraph--no-margin` - 无边距段落（用于列表、引用等内部）

### 文本格式

- `.md-strong` - 粗体文本
- `.md-emphasis` - 斜体文本
- `.md-strikethrough` - 删除线文本
- `.md-mark` - 高亮文本
- `.md-subscript` - 下标
- `.md-superscript` - 上标

### 链接

- `.md-link` - 超链接

### 列表

- `.md-list` - 列表基础类
- `.md-list--ordered` - 有序列表
- `.md-list--unordered` - 无序列表
- `.md-list--nested` - 嵌套列表
- `.md-list-item` - 列表项
- `.md-task-list` - 任务列表
- `.md-task-item` - 任务列表项
- `.md-task-checkbox` - 任务列表复选框

### 代码

- `.md-code-inline` - 行内代码
- `.md-code-block` - 代码块

### 引用

- `.md-blockquote` - 引用块

### 分割线

- `.md-hr` - 水平分割线

### 表格

- `.md-table-container` - 表格容器（带滚动）
- `.md-table` - 表格
- `.md-table-header` - 表头
- `.md-table-body` - 表体
- `.md-table-row` - 表格行
- `.md-table-header-cell` - 表头单元格
- `.md-table-cell` - 表格单元格

### 图片

- `.md-image` - 图片
- `.md-image-caption` - 图片说明

### 特殊元素

- `.md-kbd` - 键盘按键
- `.md-abbr` - 缩写
- `.md-footnote-ref` - 脚注引用
- `.md-footnotes` - 脚注区域
- `.md-footnote-item` - 脚注项
- `.md-definition-list` - 定义列表
- `.md-definition-term` - 定义术语
- `.md-definition-description` - 定义描述

## CSS 变量

系统提供了一套完整的 CSS 变量用于自定义：

```css
.md-content {
  /* 布局 */
  --md-content-width: 760px;
  --md-emphasis-width: min(920px, calc(100vw - 180px));
  --md-wide-width: min(1080px, calc(100vw - 180px));
  
  /* 字体 */
  --md-font-size: 18px;
  --md-line-height: 1.75;
  --md-font-family: Georgia, "Times New Roman", "Songti SC", serif;
  
  /* 标题 */
  --md-heading-weight: 400;
  --md-heading-spacing: -.025em;
  
  /* 段落 */
  --md-paragraph-indent: 2em;
}
```

## 使用方法

### 自动应用类名

在渲染 Markdown HTML 后调用：

```typescript
import { applyMarkdownClasses } from './markdown-class-mapper';

const container = document.querySelector('.markdown-content');
applyMarkdownClasses(container, {
  enableParagraphIndent: true,  // 启用段落首行缩进
  classPrefix: 'md',            // 类名前缀
});
```

### 移除类名

```typescript
import { removeMarkdownClasses } from './markdown-class-mapper';

removeMarkdownClasses(container, 'md');
```

### 切换功能

```typescript
import { toggleMarkdownFeature } from './markdown-class-mapper';

// 切换段落缩进
toggleMarkdownFeature(container, 'paragraph-indent', false);

// 切换链接下划线
toggleMarkdownFeature(container, 'link-underline', true);

// 切换代码高亮
toggleMarkdownFeature(container, 'code-highlighting', true);
```

## 自定义样式

### 方法 1：覆盖 CSS 变量

```css
/* 在你的自定义 CSS 中 */
.md-content {
  --md-font-size: 16px;
  --md-line-height: 1.6;
  --md-heading-weight: 600;
}
```

### 方法 2：直接覆盖类样式

```css
/* 自定义标题样式 */
.md-heading-1 {
  color: #1a1a1a;
  font-size: 2.5rem;
  border-bottom: 2px solid #e1e4e8;
}

/* 自定义代码块样式 */
.md-code-block {
  background: #282c34;
  border-radius: 8px;
  padding: 1.5rem;
}

/* 自定义链接样式 */
.md-link {
  color: #0366d6;
  text-decoration: none;
}

.md-link:hover {
  text-decoration: underline;
}
```

### 方法 3：创建主题

```css
/* GitHub 主题 */
[data-theme="github"] .md-content {
  --md-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --md-font-size: 16px;
  --md-line-height: 1.6;
}

[data-theme="github"] .md-heading {
  font-weight: 600;
  border-bottom: 1px solid #eaecef;
  padding-bottom: 0.3em;
}

[data-theme="github"] .md-code-inline {
  background: #f6f8fa;
  padding: 0.2em 0.4em;
  border-radius: 6px;
}

/* Medium 主题 */
[data-theme="medium"] .md-content {
  --md-font-family: "Georgia", serif;
  --md-font-size: 21px;
  --md-line-height: 1.58;
}

[data-theme="medium"] .md-heading {
  font-weight: 700;
  letter-spacing: -0.022em;
}
```

## 响应式设计

系统内置了移动端适配：

```css
@media (max-width: 760px) {
  .md-content {
    --md-emphasis-width: calc(100vw - 74px);
    --md-wide-width: calc(100vw - 74px);
  }

  .md-heading-1 {
    font-size: 1.85rem;
  }
}
```

## 打印样式

针对打印做了优化：

```css
@media print {
  .md-content {
    max-width: 100%;
    font-size: 12pt;
  }

  /* 避免元素被分页打断 */
  .md-code-block,
  .md-blockquote,
  .md-table,
  .md-image {
    page-break-inside: avoid;
  }
}
```

## 与现有样式的兼容性

新系统与现有的 `.markdown-reader` 样式完全兼容：

1. 保留了所有原有的 CSS 变量
2. 新类名不会影响现有功能
3. 可以逐步迁移，也可以同时使用

## 最佳实践

### 1. 中文排版

```css
.md-content {
  /* 启用首行缩进 */
  --md-paragraph-indent: 2em;
  
  /* 使用中文字体 */
  --md-font-family: "Songti SC", "STSong", Georgia, serif;
  
  /* 调整行高以适应中文 */
  --md-line-height: 1.8;
}

/* 中英文标点优化 */
.md-content {
  text-spacing: trim-start allow-end;
  hanging-punctuation: allow-end;
}
```

### 2. 代码块优化

```css
.md-code-block {
  /* 使用等宽字体 */
  font-family: "Cascadia Code", "Fira Code", "SF Mono", monospace;
  
  /* 启用连字 */
  font-variant-ligatures: common-ligatures;
  
  /* 优化滚动 */
  overflow-x: auto;
  scrollbar-width: thin;
}
```

### 3. 可访问性

```css
/* 高对比度模式 */
@media (prefers-contrast: high) {
  .md-content {
    --md-link: #0000ee;
    --md-heading-color: #000;
  }
}

/* 减少动画 */
@media (prefers-reduced-motion: reduce) {
  .md-link {
    transition: none;
  }
}

/* 焦点可见性 */
.md-link:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
```

## 性能优化

系统采用以下策略保证性能：

1. **一次性应用**：类名在渲染时一次性应用，不会重复计算
2. **CSS 优化**：使用现代 CSS 特性减少重绘
3. **选择器优化**：避免深层嵌套选择器

## 迁移指南

从原有系统迁移到新系统：

```typescript
// 之前
const root = document.createElement('article');
root.className = 'markdown-reader';
root.innerHTML = html;

// 现在
const root = document.createElement('article');
root.className = 'markdown-reader';
root.innerHTML = html;
applyMarkdownClasses(root);  // 添加这一行
```

## 调试技巧

使用浏览器开发工具查看应用的类：

```javascript
// 查看所有应用的 markdown 类
const classes = Array.from(container.querySelectorAll('*'))
  .flatMap(el => Array.from(el.classList))
  .filter(cls => cls.startsWith('md-'))
  .sort();

console.log([...new Set(classes)]);
```

## 参考资料

- [Typora 主题开发文档](https://theme.typora.io/)
- [GitHub Markdown CSS](https://github.com/sindresorhus/github-markdown-css)
- [CSS Typography Best Practices](https://betterwebtype.com/)
