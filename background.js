/**
 * AI Clean Copy — Background Service Worker
 * 
 * 负责：
 * 1. 创建右键菜单
 * 2. 右键菜单点击时向 content script 发送消息
 */

// ============================================================
// 右键菜单注册
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  // 父菜单
  chrome.contextMenus.create({
    id: 'aicc_parent',
    title: '🧹 AI Clean Copy',
    contexts: ['selection'],
  });

  // 子菜单：纯净文本
  chrome.contextMenus.create({
    id: 'aicc_plain',
    parentId: 'aicc_parent',
    title: '📄 复制为 Word 纯净文本',
    contexts: ['selection'],
  });

  // 子菜单：清洁富文本
  chrome.contextMenus.create({
    id: 'aicc_rich',
    parentId: 'aicc_parent',
    title: '📝 复制为 Word 清洁富文本',
    contexts: ['selection'],
  });

  console.log('[AICleanCopy] Context menus created.');
});

// ============================================================
// 菜单点击处理
// ============================================================

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const actionMap = {
    'aicc_plain': 'copy_clean_text',
    'aicc_rich': 'copy_clean_rich',
  };

  const action = actionMap[info.menuItemId];
  if (!action) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action });
  } catch (err) {
    console.warn('[AICleanCopy] Failed to send message to tab, trying scripting fallback:', err);

    // 降级方案：如果 content script 未加载，则通过 scripting API 注入
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['cleaner.js', 'content.js'],
      });
      // CSS 也注入
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css'],
      });
      // 重试消息
      await chrome.tabs.sendMessage(tab.id, { action });
    } catch (fallbackErr) {
      console.error('[AICleanCopy] Fallback injection also failed:', fallbackErr);
    }
  }
});

// ============================================================
// Popup 消息处理
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.from === 'popup') {
    // 转发到当前活跃标签页
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }

      try {
        const response = await chrome.tabs.sendMessage(tabs[0].id, {
          action: message.action,
          options: message.options,
        });
        sendResponse(response);
      } catch (err) {
        // 尝试注入再重试
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ['cleaner.js', 'content.js'],
          });
          await chrome.scripting.insertCSS({
            target: { tabId: tabs[0].id },
            files: ['content.css'],
          });
          const response = await chrome.tabs.sendMessage(tabs[0].id, {
            action: message.action,
            options: message.options,
          });
          sendResponse(response);
        } catch (retryErr) {
          sendResponse({ ok: false, error: retryErr.message });
        }
      }
    });
    return true; // 异步响应
  }
});
