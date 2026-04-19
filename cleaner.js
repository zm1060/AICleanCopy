/**
 * AI Clean Copy — 核心清洗引擎
 * 
 * 提供纯文本清洗和富文本清洗两套策略，
 * 针对 ChatGPT / Gemini / Claude 等 AI 平台的输出特性专门优化。
 */

// ============================================================
// 1. 基础字符级清洗（纯文本 & 富文本共用）
// ============================================================

/**
 * 移除零宽字符和 Unicode 控制字符
 * - U+200B  Zero Width Space
 * - U+200C  Zero Width Non-Joiner
 * - U+200D  Zero Width Joiner
 * - U+FEFF  Byte Order Mark / Zero Width No-Break Space
 * - U+200E  Left-to-Right Mark
 * - U+200F  Right-to-Left Mark
 * - U+2028  Line Separator
 * - U+2029  Paragraph Separator
 * - U+202A-U+202F  Bidi 控制字符 & Narrow No-Break Space
 * - U+2060  Word Joiner
 * - U+2061-U+2064  Invisible math operators
 * - U+00AD  Soft Hyphen
 */
function removeZeroWidthChars(text) {
  return text.replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u2064\uFEFF\u00AD]/g, '');
}

/**
 * 处理 Unicode 异形空格
 *
 * 策略分两类：
 * A) 直接删除（网页排版注入的装饰性空格，对内容无意义）：
 *    - U+2000  En Quad
 *    - U+2001  Em Quad
 *    - U+2002  En Space
 *    - U+2003  Em Space
 *    - U+2004  Three-Per-Em Space
 *    - U+2005  Four-Per-Em Space
 *    - U+2006  Six-Per-Em Space
 *    - U+2007  Figure Space
 *    - U+2008  Punctuation Space
 *    - U+2009  Thin Space       ← 网页中英文间距最常见
 *    - U+200A  Hair Space       ← 网页中英文间距最常见
 *    - U+205F  Medium Mathematical Space
 *
 * B) 替换为普通空格（有实际间距语义）：
 *    - U+00A0  No-Break Space (NBSP)
 *    - U+3000  Ideographic Space (全角空格)
 */
function normalizeExoticSpaces(text) {
  // A) 删除装饰性异形空格
  text = text.replace(/[\u2000-\u200A\u205F]/g, '');
  // B) 替换有语义的特殊空格
  text = text.replace(/[\u00A0\u3000]/g, ' ');
  return text;
}

/**
 * 将不间断空格 (U+00A0) 替换为普通空格
 * @deprecated 被 normalizeExoticSpaces 取代，保留以兼容
 */
function normalizeNbsp(text) {
  return text.replace(/\u00A0/g, ' ');
}

/**
 * 统一换行符为 \n
 */
function normalizeLineBreaks(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 移除行尾空白（保留换行本身）
 */
function trimTrailingWhitespace(text) {
  return text.replace(/[ \t]+\n/g, '\n');
}

/**
 * 将 3 个及以上连续空行压缩为 2 个（即最多保留一个空行）
 */
function collapseBlankLines(text) {
  return text.replace(/\n{3,}/g, '\n\n');
}

/**
 * 移除 Unicode 私用区 (PUA) 字符
 * - U+E000-U+F8FF    Basic Multilingual Plane PUA
 * - U+F0000-U+FFFFD  Supplementary PUA-A
 * - U+100000-U+10FFFD Supplementary PUA-B
 */
function removePuaChars(text) {
  return text.replace(/[\uE000-\uF8FF]/g, '')
    .replace(/[\u{F0000}-\u{FFFFD}]/gu, '')
    .replace(/[\u{100000}-\u{10FFFD}]/gu, '');
}

/**
 * 去除中文与英文/数字/符号之间的多余空格
 * 
 * 规则：只要空格的一侧是 CJK 汉字，另一侧是 ASCII 可打印字符，
 *       就删除中间的空格。纯英文之间的空格保留。
 * 
 * 示例：
 *   "计入 50 万元"     → "计入50万元"
 *   "预期 ROI 高达"    → "预期ROI高达" 
 *   "95% 收敛"         → "95%收敛"
 *   "VaR 95%"          → "VaR 95%"  （保留：两边都是 ASCII）
 */
function normalizeCjkSpacing(text) {
  // 包含 CJK 汉字与全角标点符号的扩展范围
  const cjk = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3000-\\u303f\\uff00-\\uffef';
  
  // 匹配规则：
  // 1. 左边是 CJK/全角标点，右边是 ASCII 或 CJK/全角标点
  // 2. 左边是 ASCII，右边是 CJK/全角标点
  const re = new RegExp(`([${cjk}]) +([\\x21-\\x7e${cjk}])|([\\x21-\\x7e]) +([${cjk}])`, 'g');
  
  // 使用循环确立重叠匹配（如 A _ B _ C）能被完全收敛
  let prev;
  do {
    prev = text;
    text = text.replace(re, (match, c1, c2, a1, c3) => {
      if (c1) return c1 + c2;
      return a1 + c3;
    });
  } while (text !== prev);
  
  return text;
}

/**
 * 统一标点符号
 * - 全角引号 → 正常引号（可选）
 * - 连续省略号规范化
 */
function normalizePunctuation(text) {
  // ……（两个全角省略号）→ ……
  text = text.replace(/…{3,}/g, '……');
  // 连续破折号规范化
  text = text.replace(/—{3,}/g, '——');
  return text;
}

// ============================================================
// 2. 纯文本清洗管线
// ============================================================

/**
 * 纯文本清洗 — 最稳妥的 Word 粘贴方案
 * @param {string} text - 原始纯文本
 * @param {object} options - 清洗选项
 * @param {boolean} options.preserveCodeIndent - 保留代码缩进
 * @param {boolean} options.normalizeCjk - 规范中英文间距
 * @returns {string}
 */
function cleanPlainText(text, options = {}) {
  const {
    preserveCodeIndent = false,
    normalizeCjk = true,
  } = options;

  let result = text;

  // Step 1: 移除零宽字符
  result = removeZeroWidthChars(result);

  // Step 2: 移除 PUA 字符
  result = removePuaChars(result);

  // Step 3: 替换所有 Unicode 异形空格（Thin Space、Hair Space 等）
  result = normalizeExoticSpaces(result);

  // Step 4: 统一换行符
  result = normalizeLineBreaks(result);

  // Step 5: 移除行尾空白
  result = trimTrailingWhitespace(result);

  // Step 6: 压缩空行
  result = collapseBlankLines(result);

  // Step 7: 规范中英文间距（可选）
  if (normalizeCjk) {
    // 如果需要保留代码缩进，则仅处理非代码行
    if (preserveCodeIndent) {
      result = processNonCodeLines(result, normalizeCjkSpacing);
    } else {
      result = normalizeCjkSpacing(result);
    }
  }

  // Step 8: 规范标点
  result = normalizePunctuation(result);

  // Step 9: 首尾空白
  result = result.trim();

  return result;
}

/**
 * 处理非代码行，跳过 ``` 包围的代码块
 */
function processNonCodeLines(text, processor) {
  const lines = text.split('\n');
  let inCodeBlock = false;
  const result = [];

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
    } else if (inCodeBlock) {
      result.push(line); // 代码块内不处理
    } else {
      result.push(processor(line));
    }
  }

  return result.join('\n');
}

// ============================================================
// 3. 富文本 (HTML) 清洗管线
// ============================================================

/**
 * 清洗 HTML，保留 Word 友好的语义标签，移除有害样式
 * @param {string} html - 原始 HTML 字符串
 * @returns {string} 清洗后的 HTML
 */
function cleanRichHtml(html, options = {}) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 递归清洗 DOM 树
  cleanDomNode(doc.body, options);

  // 添加 Word 兼容的基础样式
  const style = doc.createElement('style');
  style.textContent = `
    body { font-family: "Microsoft YaHei", "微软雅黑", SimSun, serif; font-size: 12pt; line-height: 1.6; color: #000000; }
    table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
    table, th, td { border: 1px solid #000000; padding: 6pt 8pt; }
    th { background-color: #f2f2f2; font-weight: bold; }
    pre, code { font-family: Consolas, "Courier New", monospace; font-size: 10pt; }
    pre { background-color: #f5f5f5; border: 1px solid #d0d0d0; padding: 8pt 12pt; margin: 8pt 0; white-space: pre-wrap; word-wrap: break-word; }
    code { background-color: #f0f0f0; padding: 1pt 4pt; border-radius: 2pt; }
    pre code { background-color: transparent; padding: 0; border-radius: 0; }
    blockquote { border-left: 3pt solid #cccccc; padding-left: 12pt; margin: 8pt 0; color: #333333; }
    h1 { font-size: 22pt; font-weight: bold; margin: 12pt 0 6pt 0; }
    h2 { font-size: 18pt; font-weight: bold; margin: 10pt 0 5pt 0; }
    h3 { font-size: 14pt; font-weight: bold; margin: 8pt 0 4pt 0; }
    h4, h5, h6 { font-size: 12pt; font-weight: bold; margin: 6pt 0 3pt 0; }
    ul, ol { margin: 6pt 0; padding-left: 24pt; }
    li { margin: 2pt 0; }
    p { margin: 6pt 0; }
    strong, b { font-weight: bold; }
    em, i { font-style: italic; }
  `;
  doc.head.appendChild(style);

  // 设置 charset
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  doc.head.insertBefore(meta, doc.head.firstChild);

  return doc.documentElement.outerHTML;
}

/**
 * Word 允许的标签白名单
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'pre', 'code',
  'blockquote',
  'a',
  'img',
  'hr',
  'span',
]);

/**
 * 允许保留的 CSS 属性（Word 能理解的子集）
 */
const ALLOWED_CSS_PROPS = new Set([
  'font-weight',
  'font-style',
  'font-size',
  'font-family',
  'text-decoration',
  'text-align',
  'color',
  'background-color',
  'border',
  'border-collapse',
  'padding',
  'margin',
  'width',
  'height',
  'vertical-align',
  'white-space',
  'list-style-type',
]);

/**
 * 递归清洗 DOM 节点
 */
function cleanDomNode(node, options = {}) {
  if (!node) return;

  // 文本节点：清洗零宽字符 & 异形空格
  if (node.nodeType === Node.TEXT_NODE) {
    let text = node.textContent;

    // 清理掉纯粹用于 HTML 排版导致的缩进换行
    if (text.trim() === '' && text.includes('\n')) {
      node.textContent = '';
      return;
    }

    text = removeZeroWidthChars(text);
    text = removePuaChars(text);
    text = normalizeExoticSpaces(text);
    if (options.normalizeCjk) {
      text = normalizeCjkSpacing(text);
    }
    
    // Word 不支持 white-space: pre-wrap 导致真实换行被合并为空格，需转换为 <br>
    if (text.includes('\n')) {
      const fragment = document.createDocumentFragment();
      const parts = text.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) fragment.appendChild(document.createTextNode(parts[i]));
        if (i < parts.length - 1) fragment.appendChild(document.createElement('br'));
      }
      node.replaceWith(fragment);
      return;
    }

    node.textContent = text;
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName.toLowerCase();

  // 移除不允许的标签但保留其子内容
  if (!ALLOWED_TAGS.has(tag) && tag !== 'body' && tag !== 'html' && tag !== 'head') {
    // 对于 script / style / svg / canvas 等：整个移除
    const removeEntirely = new Set(['script', 'style', 'svg', 'canvas', 'noscript', 'iframe', 'object', 'embed']);
    if (removeEntirely.has(tag)) {
      node.remove();
      return;
    }

    // 其他标签：用 span 包裹子节点（展开到父级）
    const fragment = document.createDocumentFragment();
    while (node.firstChild) {
      fragment.appendChild(node.firstChild);
    }
    node.replaceWith(fragment);
    // 注意：此时 node 已脱离 DOM，子节点被提升
    // 需要对 fragment 中的节点继续清洗，但它们已经在父节点的 childNodes 中
    return;
  }

  // 清洗属性
  if (tag !== 'body' && tag !== 'html' && tag !== 'head') {
    cleanElementAttributes(node);
  }

  // 递归处理子节点（从后往前以避免动态修改导致跳过）
  const children = Array.from(node.childNodes);
  for (const child of children) {
    cleanDomNode(child, options);
  }
}

/**
 * 清洗元素属性：
 * - 移除 class
 * - 过滤 style 中 Word 不支持的 CSS 属性
 * - 保留 href / src 等必要属性
 */
function cleanElementAttributes(el) {
  const tag = el.tagName.toLowerCase();

  // 移除 class（Tailwind 类名对 Word 无意义）
  el.removeAttribute('class');

  // 移除 data-* 属性
  const attrs = Array.from(el.attributes);
  for (const attr of attrs) {
    if (attr.name.startsWith('data-')) {
      el.removeAttribute(attr.name);
    }
  }

  // 过滤 style
  if (el.hasAttribute('style')) {
    const raw = el.getAttribute('style');
    const cleanedStyle = filterCssProperties(raw);
    if (cleanedStyle) {
      el.setAttribute('style', cleanedStyle);
    } else {
      el.removeAttribute('style');
    }
  }

  // 对 code/pre 标签：强制设置等宽字体
  if (tag === 'pre' || tag === 'code') {
    // 移除语法高亮的行内颜色（防止白底白字）
    el.style.removeProperty('color');
    el.style.removeProperty('background');
    el.style.removeProperty('background-color');
  }

  // 对表格：确保边框可见
  if (tag === 'table') {
    el.setAttribute('border', '1');
    el.setAttribute('cellpadding', '4');
    el.setAttribute('cellspacing', '0');
  }

  // 移除不必要属性
  const unnecessaryAttrs = ['role', 'aria-label', 'aria-hidden', 'tabindex', 'draggable'];
  for (const attrName of unnecessaryAttrs) {
    el.removeAttribute(attrName);
  }
}

/**
 * 过滤 CSS 属性，仅保留 Word 能理解的属性
 */
function filterCssProperties(styleString) {
  if (!styleString) return '';

  const parts = styleString.split(';').filter(Boolean);
  const kept = [];

  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = part.substring(0, colonIdx).trim().toLowerCase();
    const value = part.substring(colonIdx + 1).trim();

    if (ALLOWED_CSS_PROPS.has(prop) && value) {
      // 跳过可能导致白底白字的 color 声明
      if (prop === 'color' && isProblematicColor(value)) {
        continue;
      }
      kept.push(`${prop}: ${value}`);
    }
  }

  return kept.join('; ');
}

/**
 * 检测可能导致白底白字的颜色值
 */
function isProblematicColor(value) {
  const v = value.toLowerCase().trim();
  // 白色 / 接近白色
  if (v === 'white' || v === '#fff' || v === '#ffffff') return true;
  if (v === 'transparent') return true;
  // rgb(255,255,255) 或接近
  const rgbMatch = v.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch.map(Number);
    if (r > 240 && g > 240 && b > 240) return true;
  }
  return false;
}

// ============================================================
// 4. MathJax / KaTeX 公式提取
// ============================================================

/**
 * 从 MathJax / KaTeX 渲染的元素中提取原始 LaTeX 源码
 * @param {Element} el - 一个数学公式渲染的元素
 * @returns {{ latex: string, isBlock: boolean } | null}
 */
function extractLatexFromMathElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;

  // ---- 通用带有公式源码的属性 (例如 DeepSeek / 某些兼容 Markdown 渲染) ----
  const customMathAttr = el.getAttribute('data-math') || el.getAttribute('data-tex') || el.getAttribute('data-formula');
  if (customMathAttr) {
    const isBlock = el.tagName.toLowerCase() === 'div' || 
                    el.classList.contains('math-block') || 
                    el.classList.contains('display-math') ||
                    (el.style && el.style.display === 'block');
    return { latex: customMathAttr.trim(), isBlock };
  }

  // ---- MathJax 3.x ----
  // MathJax 3 渲染后的容器 <mjx-container>, 源码存在
  // <script type="math/tex"> 子元素或 data 属性中
  if (el.tagName && el.tagName.toLowerCase() === 'mjx-container') {
    const isBlock = el.hasAttribute('display');
    // 尝试从隐藏的 <script> 子元素读取
    const scriptEl = el.querySelector('script[type*="math/tex"], script[type*="math/asciimath"]');
    if (scriptEl && scriptEl.textContent) {
      return { latex: scriptEl.textContent.trim(), isBlock };
    }
    // 尝试从 aria-label 或 data-latex
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return { latex: ariaLabel.trim(), isBlock };
    const dataLatex = el.getAttribute('data-latex');
    if (dataLatex) return { latex: dataLatex.trim(), isBlock };
  }

  // ---- MathJax 2.x ----
  // 容器常为 <span class="MathJax"> 或 <span class="MathJax_Display">
  // 对应的 <script type="math/tex"> 是紧邻的兄弟元素
  if (el.classList && (el.classList.contains('MathJax') || el.classList.contains('MathJax_Display'))) {
    const isBlock = el.classList.contains('MathJax_Display');
    // MathJax 2 把 <script> 放在同级的紧邻兄弟
    let sibling = el.nextElementSibling;
    if (sibling && sibling.tagName === 'SCRIPT' && sibling.type && sibling.type.indexOf('math/tex') !== -1) {
      return { latex: sibling.textContent.trim(), isBlock };
    }
    // 也可能在 data 属性中
    const dataFormula = el.getAttribute('data-mathml') || el.getAttribute('data-latex');
    if (dataFormula) return { latex: dataFormula.trim(), isBlock };
  }

  // ---- KaTeX ----
  // <span class="katex"> 或 <span class="katex-display">
  // KaTeX 在 <annotation encoding="application/x-tex"> 里保存原始 LaTeX
  if (el.classList && (el.classList.contains('katex') || el.classList.contains('katex-display'))) {
    const isBlock = el.classList.contains('katex-display') ||
      (el.parentElement && el.parentElement.classList && el.parentElement.classList.contains('katex-display'));
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation && annotation.textContent) {
      return { latex: annotation.textContent.trim(), isBlock };
    }
  }

  // ---- 通用：<math> 元素中包含 annotation ----
  if (el.tagName && el.tagName.toLowerCase() === 'math') {
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation && annotation.textContent) {
      const isBlock = el.getAttribute('display') === 'block';
      return { latex: annotation.textContent.trim(), isBlock };
    }
  }

  return null;
}

/**
 * 判断一个元素是否是数学公式渲染元素
 */
function isMathElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'mjx-container' || tag === 'math') return true;
  
  if (el.hasAttribute('data-math') || el.hasAttribute('data-tex') || el.hasAttribute('data-formula')) {
    return true;
  }

  if (el.classList) {
    if (el.classList.contains('MathJax') || el.classList.contains('MathJax_Display') ||
      el.classList.contains('katex') || el.classList.contains('katex-display') ||
      el.classList.contains('math-block') || el.classList.contains('math-inline')) {
      return true;
    }
  }
  return false;
}

/**
 * 判断一个元素是否是 MathJax 2 的隐藏 script 元素
 */
function isMathScript(el) {
  return el && el.tagName === 'SCRIPT' && el.type && el.type.indexOf('math/tex') !== -1;
}

// ============================================================
// 5. 从 Selection 获取 HTML / 文本（含公式提取）
// ============================================================

/**
 * 获取当前选区的 HTML 内容（已将公式替换为 LaTeX 源码）
 * @returns {string} HTML 字符串
 */
function getSelectionHtml() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return '';

  const container = document.createElement('div');
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentElement;
    
    const mathAncestor = ancestor ? ancestor.closest('[data-math], mjx-container, math, .MathJax, .MathJax_Display, .katex, .katex-display, .math-block, .display-math') : null;
    
    if (mathAncestor) {
      const mathInfo = extractLatexFromMathElement(mathAncestor);
      if (mathInfo) {
        const wrapper = mathAncestor.isBlock || mathInfo.isBlock ? '$$' : '$';
        const textNode = document.createTextNode(wrapper + mathInfo.latex + wrapper);
        container.appendChild(textNode);
        continue;
      }
    }
    
    container.appendChild(range.cloneContents());
  }

  // 对克隆出来的 DOM 树执行公式替换
  replaceMathElementsInDom(container);

  return container.innerHTML;
}

/**
 * 在克隆的 DOM 树中将数学公式元素替换为 LaTeX 文本节点
 */
function replaceMathElementsInDom(root) {
  // 从底部向上遍历，避免修改时跳过节点
  const walk = (node) => {
    if (!node) return;
    // 先递归子节点
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const mathInfo = extractLatexFromMathElement(child);
        if (mathInfo) {
          const wrapper = child.isBlock || mathInfo.isBlock ? '$$' : '$';
          const textNode = document.createTextNode(wrapper + mathInfo.latex + wrapper);
          child.replaceWith(textNode);
          continue;
        }
        walk(child);
      }
    }
  };
  walk(root);
}

/**
 * 获取当前选区的纯文本内容（含公式 LaTeX 还原）
 * @returns {string}
 */
function getSelectionText() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return '';

  // 需要遍历选区中的 DOM 节点以识别数学公式
  const parts = [];

  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentElement;
    
    const mathAncestor = ancestor ? ancestor.closest('[data-math], mjx-container, math, .MathJax, .MathJax_Display, .katex, .katex-display, .math-block, .display-math') : null;
    
    if (mathAncestor) {
      const mathInfo = extractLatexFromMathElement(mathAncestor);
      if (mathInfo) {
        const wrapper = mathInfo.isBlock ? '$$' : '$';
        parts.push(wrapper + mathInfo.latex + wrapper);
        continue;
      }
    }

    const fragment = range.cloneContents();
    walkNodesForLatex(fragment, parts);
  }

  return parts.join('');
}

/**
 * 递归遍历 DOM 节点，对数学公式元素提取 LaTeX，其余提取纯文本
 * 注意：cloneContents() 克隆出来的公式元素可能不完整，
 * 所以我们还需要在原始 DOM 上查找对应的完整元素。
 */
function walkNodesForLatex(node, parts) {
  if (!node) return;

  if (node.nodeType === Node.TEXT_NODE) {
    let text = node.textContent;
    // 忽略纯粹用于 HTML 代码排版的含换行空白字符（否则会导致多余空行）
    if (text.trim() === '' && text.includes('\n')) {
      return;
    }
    parts.push(text);
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

  let isBlock = false;

  // 对元素节点检查是否为公式
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') {
      parts.push('\n');
      return;
    }

    const blockTags = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'article', 'section', 'blockquote', 'tr', 'td', 'th']);
    if (blockTags.has(tag)) {
      isBlock = true;
      if (parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
        parts.push('\n');
      }
    }

    // 先尝试从克隆的片段中直接提取
    let mathInfo = extractLatexFromMathElement(node);
    if (mathInfo) {
      if (mathInfo.isBlock) {
        if (parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) parts.push('\n');
        parts.push('$$' + mathInfo.latex + '$$\n');
      } else {
        parts.push('$' + mathInfo.latex + '$');
      }
      return;
    }

    // 跳过 MathJax 2 的 hidden script（已在前面的 MathJax 元素中处理）
    if (isMathScript(node)) return;
  }

  // 递归子节点
  for (const child of node.childNodes) {
    walkNodesForLatex(child, parts);
  }

  if (isBlock) {
    if (parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
      parts.push('\n');
    }
  }
}

// ============================================================
// 6. 导出（content script 全局可用）
// ============================================================

// 将函数挂载到 window 上以便 content.js 使用
if (typeof window !== 'undefined') {
  window.__AICleanCopy = {
    cleanPlainText,
    cleanRichHtml,
    getSelectionHtml,
    getSelectionText,
    removeZeroWidthChars,
    removePuaChars,
    normalizeExoticSpaces,
    normalizeNbsp,
    normalizeLineBreaks,
    trimTrailingWhitespace,
    collapseBlankLines,
    normalizeCjkSpacing,
    normalizePunctuation,
    extractLatexFromMathElement,
    isMathElement,
  };
}
