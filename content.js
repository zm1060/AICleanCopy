/**
 * AI Clean Copy — Content Script
 * 
 * 注入到页面中，负责：
 * 1. 监听来自 background.js 的消息
 * 2. 读取选区内容
 * 3. 调用 cleaner.js 进行清洗
 * 4. 写入剪贴板
 * 5. 显示 Toast 通知
 */

// ============================================================
// Toast 通知
// ============================================================

function showToast(message, type = 'success') {
  // 移除已有的 toast
  const existing = document.querySelector('.aicc-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'aicc-toast';
  toast.setAttribute('data-type', type);

  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
  toast.innerHTML = `
    <span class="aicc-toast-icon">${icon}</span>
    <span class="aicc-toast-text">${message}</span>
  `;

  document.body.appendChild(toast);

  // 触发动画
  requestAnimationFrame(() => {
    toast.classList.add('aicc-toast-show');
  });

  // 自动消失
  setTimeout(() => {
    toast.classList.add('aicc-toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ============================================================
// 用户选项（从 storage 读取）
// ============================================================

let userOptions = {
  normalizeCjk: true,
  preserveCode: true,
  removePua: true,
  collapseLines: true,
};

// 启动时读取
try {
  chrome.storage?.local?.get('aicc_options', (result) => {
    if (result?.aicc_options) {
      Object.assign(userOptions, result.aicc_options);
    }
  });
} catch (e) { /* storage 不可用时用默认值 */ }

// ============================================================
// 剪贴板写入
// ============================================================

/**
 * 写入纯文本到剪贴板
 */
async function writeCleanPlainText() {
  const cleaner = window.__AICleanCopy;
  if (!cleaner) {
    showToast('清洗引擎未加载', 'error');
    return;
  }

  const rawText = cleaner.getSelectionText();
  if (!rawText) {
    showToast('请先选中内容', 'error');
    return;
  }

  const cleaned = cleaner.cleanPlainText(rawText, {
    preserveCodeIndent: userOptions.preserveCode,
    normalizeCjk: userOptions.normalizeCjk,
  });

  try {
    await navigator.clipboard.writeText(cleaned);
    showToast('已复制为 Word 纯净文本');
  } catch (err) {
    // 降级方案：使用 execCommand
    fallbackCopyText(cleaned);
    showToast('已复制为 Word 纯净文本');
  }
}

/**
 * 写入清洁富文本到剪贴板（text/plain + text/html 双格式）
 */
async function writeCleanRichText() {
  const cleaner = window.__AICleanCopy;
  if (!cleaner) {
    showToast('清洗引擎未加载', 'error');
    return;
  }

  const rawHtml = cleaner.getSelectionHtml();
  const rawText = cleaner.getSelectionText();

  if (!rawText && !rawHtml) {
    showToast('请先选中内容', 'error');
    return;
  }

  const cleanedText = cleaner.cleanPlainText(rawText, {
    preserveCodeIndent: userOptions.preserveCode,
    normalizeCjk: userOptions.normalizeCjk,
  });

  const cleanedHtml = cleaner.cleanRichHtml(rawHtml, {
    preserveCodeIndent: userOptions.preserveCode,
    normalizeCjk: userOptions.normalizeCjk,
  });

  try {
    const htmlBlob = new Blob([cleanedHtml], { type: 'text/html' });
    const textBlob = new Blob([cleanedText], { type: 'text/plain' });

    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob,
      })
    ]);
    showToast('已复制为 Word 清洁富文本');
  } catch (err) {
    // 降级：至少写入纯文本
    try {
      await navigator.clipboard.writeText(cleanedText);
      showToast('已复制（降级为纯文本）', 'info');
    } catch (err2) {
      fallbackCopyText(cleanedText);
      showToast('已复制（降级为纯文本）', 'info');
    }
  }
}

/**
 * 降级复制方案
 */
function fallbackCopyText(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } catch (e) {
    console.error('[AICleanCopy] fallback copy failed:', e);
  }
  document.body.removeChild(textarea);
}

// ============================================================
// 消息监听
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 同步选项更新
  if (message.action === 'update_options' && message.options) {
    Object.assign(userOptions, message.options);
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === 'copy_clean_text') {
    // 如果消息带了选项，先同步
    if (message.options) Object.assign(userOptions, message.options);
    writeCleanPlainText().then(() => sendResponse({ ok: true }));
    return true; // 异步响应
  }

  if (message.action === 'copy_clean_rich') {
    if (message.options) Object.assign(userOptions, message.options);
    writeCleanRichText().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.action === 'get_selection_info') {
    const cleaner = window.__AICleanCopy;
    const text = cleaner ? cleaner.getSelectionText() : '';
    const cleaned = cleaner ? cleaner.cleanPlainText(text, {
      preserveCodeIndent: userOptions.preserveCode,
      normalizeCjk: userOptions.normalizeCjk,
    }) : text;
    const dirtyCount = text.length - cleaned.length;
    sendResponse({
      hasSelection: text.length > 0,
      length: cleaned.length,
      rawLength: text.length,
      dirtyCount,
      preview: text.substring(0, 100),
    });
    return false;
  }
});

// ============================================================
// 快捷键支持（两步组合键）
// Ctrl+C → 松开 → 按 Space  →  复制为纯净文本
// Ctrl+V → 松开 → 按 Space  →  复制为清洁富文本
// ============================================================

let _aiccPendingAction = null;   // 'copy' | 'paste' | null
let _aiccPendingTimer = null;

document.addEventListener('keydown', (e) => {
  // 第一步：检测 Ctrl+C 或 Ctrl+V
  if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
    if (e.key === 'c' || e.key === 'C') {
      // 先让浏览器默认的 Ctrl+C 正常执行（复制选区到剪贴板）
      // 同时记录一个待定状态，如果紧接着按了空格就触发清洁复制
      clearTimeout(_aiccPendingTimer);
      _aiccPendingAction = 'copy';
      _aiccPendingTimer = setTimeout(() => { _aiccPendingAction = null; }, 500);
      return; // 不阻止默认行为
    }
    if (e.key === 'v' || e.key === 'V') {
      clearTimeout(_aiccPendingTimer);
      _aiccPendingAction = 'paste';
      _aiccPendingTimer = setTimeout(() => { _aiccPendingAction = null; }, 500);
      return;
    }
  }

  // 第二步：检测 Space（在 500ms 窗口内）
  if (e.key === ' ' && _aiccPendingAction) {
    e.preventDefault();
    e.stopImmediatePropagation();

    if (_aiccPendingAction === 'copy') {
      writeCleanPlainText();
    } else if (_aiccPendingAction === 'paste') {
      writeCleanRichText();
    }

    _aiccPendingAction = null;
    clearTimeout(_aiccPendingTimer);
  }
});
