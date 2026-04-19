/**
 * AI Clean Copy — Popup 逻辑
 */

document.addEventListener('DOMContentLoaded', () => {
  const btnPlain = document.getElementById('btnPlainText');
  const btnRich = document.getElementById('btnRichText');
  const statusEl = document.getElementById('selectionStatus');

  // 选项 checkboxes
  const optCjk = document.getElementById('optCjkSpacing');
  const optCode = document.getElementById('optPreserveCode');
  const optPua = document.getElementById('optRemovePua');
  const optLines = document.getElementById('optCollapseLines');

  // ---- 从 storage 恢复选项 ----
  chrome.storage?.local?.get('aicc_options', (result) => {
    if (result?.aicc_options) {
      const o = result.aicc_options;
      if (o.normalizeCjk !== undefined) optCjk.checked = o.normalizeCjk;
      if (o.preserveCode !== undefined) optCode.checked = o.preserveCode;
      if (o.removePua !== undefined) optPua.checked = o.removePua;
      if (o.collapseLines !== undefined) optLines.checked = o.collapseLines;
    }
  });

  // ---- 选项变更时保存 ----
  function getOptions() {
    return {
      normalizeCjk: optCjk.checked,
      preserveCode: optCode.checked,
      removePua: optPua.checked,
      collapseLines: optLines.checked,
    };
  }

  function saveOptions() {
    const options = getOptions();
    chrome.storage?.local?.set({ aicc_options: options });
    // 同步到当前页面的 content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'update_options',
          options,
        }).catch(() => {});
      }
    });
  }

  [optCjk, optCode, optPua, optLines].forEach((el) => {
    el.addEventListener('change', saveOptions);
  });

  // ---- 检测选区状态 ----
  checkSelection();

  async function checkSelection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        updateStatus(false, '无法访问当前标签页');
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'get_selection_info' });
      if (response?.hasSelection) {
        let statusMsg = `已选中 ${response.length} 个字符`;
        if (response.dirtyCount > 0) {
          statusMsg += `，发现 ${response.dirtyCount} 个垃圾字符`;
        }
        updateStatus(true, statusMsg);
      } else {
        updateStatus(false, '未检测到选中内容，请先在页面中选中文本');
      }
    } catch (err) {
      updateStatus(false, '请先在页面中选中内容');
    }
  }

  function updateStatus(hasSelection, text) {
    statusEl.classList.toggle('has-selection', hasSelection);
    statusEl.classList.toggle('no-selection', !hasSelection);
    statusEl.querySelector('.status-text').textContent = text;
  }

  // ---- 按钮点击 ----
  btnPlain.addEventListener('click', () => handleCopy('copy_clean_text', btnPlain));
  btnRich.addEventListener('click', () => handleCopy('copy_clean_rich', btnRich));

  async function handleCopy(action, btn) {
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        from: 'popup',
        action,
        options: getOptions(),
      });

      btn.classList.remove('loading');
      btn.classList.add('success');

      const originalTitle = btn.querySelector('.btn-title').textContent;
      btn.querySelector('.btn-title').textContent = '✓ 已复制到剪贴板';

      setTimeout(() => {
        btn.classList.remove('success');
        btn.querySelector('.btn-title').textContent = originalTitle;
        btn.disabled = false;
      }, 1500);
    } catch (err) {
      btn.classList.remove('loading');
      btn.classList.add('error');
      btn.querySelector('.btn-title').textContent = '复制失败，请重试';
      btn.disabled = false;

      setTimeout(() => {
        btn.classList.remove('error');
        btn.querySelector('.btn-title').textContent =
          action === 'copy_clean_text' ? '复制为 Word 纯净文本' : '复制为 Word 清洁富文本';
      }, 2000);
    }
  }
});
