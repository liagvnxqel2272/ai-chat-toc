/**
 * AI Chat TOC - 对话目录导航
 * 支持平台: ChatGPT, Claude, Gemini
 * 交互模式: Octotree 风格，鼠标悬停触发 + 钉住功能
 */

(function () {
  'use strict';

  // ========== 选择器降级辅助 ==========
  // 依次尝试一组选择器，命中即返回；全部失败时记录到 console 便于排查平台改版
  function querySelectorFallback(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function querySelectorAllFallback(selectors, root = document) {
    for (const sel of selectors) {
      const list = root.querySelectorAll(sel);
      if (list.length > 0) return list;
    }
    return root.querySelectorAll(selectors[selectors.length - 1]);
  }

  // ========== 平台适配器 ==========
  // 每个平台的选择器都按「最稳定 → 兜底」排序，AI 站改版时优先调整这里
  const platformAdapters = {
    chatgpt: {
      name: 'ChatGPT',
      hostMatch: /chatgpt\.com|chat\.openai\.com/,
      userMsgSelectors: [
        '[data-message-author-role="user"]',
        'article[data-testid^="conversation-turn"] [data-message-author-role="user"]',
      ],
      textSelectors: ['.whitespace-pre-wrap', '[class*="whitespace-pre"]'],
      containerSelectors: ['[role="presentation"]', 'main'],
      getUserMessages() { return querySelectorAllFallback(this.userMsgSelectors); },
      getMessageText(el) {
        const textEl = querySelectorFallback(this.textSelectors, el);
        return (textEl ? textEl.textContent : el.textContent).trim();
      },
      getChatContainer() { return querySelectorFallback(this.containerSelectors); },
    },

    claude: {
      name: 'Claude',
      hostMatch: /claude\.ai/,
      userMsgSelectors: [
        '[data-testid="user-message"]',
        'div[data-test-render-count] [data-testid="user-message"]',
      ],
      textSelectors: ['p', '.whitespace-pre-wrap'],
      containerSelectors: [
        '[data-testid="conversation-turn-wrapper"]',
        'main',
      ],
      getUserMessages() { return querySelectorAllFallback(this.userMsgSelectors); },
      getMessageText(el) {
        const textEl = querySelectorFallback(this.textSelectors, el);
        return (textEl ? textEl.textContent : el.textContent).trim();
      },
      getChatContainer() {
        const turn = document.querySelector('[data-testid="conversation-turn-wrapper"]');
        if (turn?.parentElement) return turn.parentElement;
        return document.querySelector('main');
      },
    },

    gemini: {
      name: 'Gemini',
      hostMatch: /gemini\.google\.com/,
      userMsgSelectors: [
        '.query-text',
        '[data-text-query]',
        'user-query .query-content',
      ],
      containerSelectors: ['.conversation-container', 'chat-window', 'main'],
      getUserMessages() { return querySelectorAllFallback(this.userMsgSelectors); },
      getMessageText(el) { return el.textContent.trim(); },
      getChatContainer() { return querySelectorFallback(this.containerSelectors); },
    },
  };

  // ========== 状态管理 ==========
  let currentAdapter = null;
  let sidebar = null;
  let triggerZone = null;
  let isPinned = false;
  let isVisible = false;
  let hideTimer = null;
  let observer = null;
  let debounceTimer = null;

  const HIDE_DELAY = 400;

  // ========== 检测当前平台 ==========
  function detectPlatform() {
    const hostname = window.location.hostname;
    for (const [key, adapter] of Object.entries(platformAdapters)) {
      if (adapter.hostMatch.test(hostname)) {
        console.log(`[AI Chat TOC] 检测到平台: ${adapter.name}`);
        return adapter;
      }
    }
    return null;
  }

  // ========== 截断文本 ==========
  function truncateText(text, maxLen = 40) {
    if (!text) return '(空消息)';
    const firstLine = text.split('\n')[0].trim();
    if (firstLine.length <= maxLen) return firstLine;
    return firstLine.substring(0, maxLen) + '...';
  }

  // ========== 显示/隐藏侧边栏 ==========
  function showSidebar() {
    clearTimeout(hideTimer);
    if (isVisible) return;
    isVisible = true;
    sidebar.classList.add('visible');
    triggerZone.classList.add('sidebar-open');
  }

  function hideSidebar() {
    if (isPinned) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      isVisible = false;
      sidebar.classList.remove('visible');
      triggerZone.classList.remove('sidebar-open');
    }, HIDE_DELAY);
  }

  function cancelHide() {
    clearTimeout(hideTimer);
  }

  // ========== 切换钉住状态 ==========
  function togglePin() {
    isPinned = !isPinned;
    sidebar.classList.toggle('pinned', isPinned);
    savePinState();

    const pinBtn = sidebar.querySelector('.toc-pin-btn');
    if (pinBtn) {
      pinBtn.innerHTML = isPinned ? '📌' : '📍';
      pinBtn.title = isPinned ? '取消固定' : '固定侧边栏';
    }
  }

  // ========== 保存/读取钉住状态 ==========
  function savePinState() {
    try {
      localStorage.setItem('ai-chat-toc-pinned', isPinned);
    } catch (e) { /* ignore */ }
  }

  function loadPinState() {
    try {
      const saved = localStorage.getItem('ai-chat-toc-pinned');
      if (saved === 'true') {
        isPinned = true;
        isVisible = true;
        sidebar.classList.add('pinned', 'visible');
        triggerZone.classList.add('sidebar-open');
        const pinBtn = sidebar.querySelector('.toc-pin-btn');
        if (pinBtn) {
          pinBtn.innerHTML = '📌';
          pinBtn.title = '取消固定';
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ========== 创建触发区域 + 侧边栏 ==========
  function createSidebar() {
    // 右侧边缘触发区域
    triggerZone = document.createElement('div');
    triggerZone.id = 'ai-chat-toc-trigger';
    triggerZone.innerHTML = '<span class="trigger-icon">📑</span>';
    document.body.appendChild(triggerZone);

    // 侧边栏容器
    sidebar = document.createElement('div');
    sidebar.id = 'ai-chat-toc-sidebar';
    sidebar.innerHTML = `
      <div class="toc-header">
        <span class="toc-title">📑 对话目录</span>
        <div class="toc-header-actions">
          <span class="toc-count">0 条</span>
          <button class="toc-pin-btn" title="固定侧边栏">📍</button>
        </div>
      </div>
      <div class="toc-search">
        <input type="text" placeholder="搜索对话..." class="toc-search-input" />
      </div>
      <div class="toc-list"></div>
      <div class="toc-footer">
        <span class="toc-platform">${currentAdapter.name}</span>
        <span class="toc-hint">悬停显示 · 📌固定</span>
      </div>
    `;
    document.body.appendChild(sidebar);

    // ===== 事件绑定 =====

    // 触发区域
    triggerZone.addEventListener('mouseenter', showSidebar);
    triggerZone.addEventListener('mouseleave', hideSidebar);

    // 侧边栏本体
    sidebar.addEventListener('mouseenter', cancelHide);
    sidebar.addEventListener('mouseleave', hideSidebar);

    // 钉住按钮
    sidebar.querySelector('.toc-pin-btn').addEventListener('click', togglePin);

    // 搜索
    sidebar.querySelector('.toc-search-input').addEventListener('input', (e) => {
      filterTocItems(e.target.value);
    });

    // 键盘快捷键: Ctrl/Cmd + Shift + T
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        if (!isVisible) {
          showSidebar();
          togglePin();
        } else {
          togglePin();
          if (!isPinned) hideSidebar();
        }
      }
    });

    loadPinState();
  }

  // ========== 提取对话并更新目录 ==========
  function updateToc() {
    if (!currentAdapter || !sidebar) return;

    const messages = currentAdapter.getUserMessages();
    const tocList = sidebar.querySelector('.toc-list');
    const tocCount = sidebar.querySelector('.toc-count');

    tocList.innerHTML = '';

    if (messages.length === 0) {
      tocList.innerHTML = '<div class="toc-empty">暂无对话内容</div>';
      tocCount.textContent = '0 条';
      return;
    }

    tocCount.textContent = `${messages.length} 条`;

    messages.forEach((msgEl, index) => {
      const text = currentAdapter.getMessageText(msgEl);
      const displayText = truncateText(text);

      const item = document.createElement('div');
      item.className = 'toc-item';
      item.dataset.index = index;
      item.dataset.fullText = text.toLowerCase();

      const idxSpan = document.createElement('span');
      idxSpan.className = 'toc-item-index';
      idxSpan.textContent = String(index + 1);

      const textSpan = document.createElement('span');
      textSpan.className = 'toc-item-text';
      textSpan.title = text;
      textSpan.textContent = displayText;

      item.appendChild(idxSpan);
      item.appendChild(textSpan);

      item.addEventListener('click', () => {
        scrollToMessage(msgEl, index);
      });

      item.addEventListener('mouseenter', () => {
        msgEl.classList.add('toc-highlight');
      });
      item.addEventListener('mouseleave', () => {
        msgEl.classList.remove('toc-highlight');
      });

      tocList.appendChild(item);
    });

    // 更新触发条上的数量徽标
    let badge = triggerZone.querySelector('.trigger-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'trigger-badge';
      triggerZone.appendChild(badge);
    }
    badge.textContent = messages.length;
  }

  // ========== 跳转到指定消息 ==========
  function scrollToMessage(el, index) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    el.classList.add('toc-flash');
    setTimeout(() => el.classList.remove('toc-flash'), 1500);

    sidebar.querySelectorAll('.toc-item').forEach((item) => {
      item.classList.toggle('active', parseInt(item.dataset.index) === index);
    });
  }

  // ========== 搜索过滤 ==========
  function filterTocItems(keyword) {
    const items = sidebar.querySelectorAll('.toc-item');
    const lowerKeyword = keyword.toLowerCase().trim();

    items.forEach((item) => {
      if (!lowerKeyword) {
        item.style.display = '';
        return;
      }
      const fullText = item.dataset.fullText;
      item.style.display = fullText.includes(lowerKeyword) ? '' : 'none';
    });
  }

  // ========== 监听DOM变化 ==========
  function startObserver() {
    const container = currentAdapter.getChatContainer();
    if (!container) {
      setTimeout(startObserver, 1000);
      return;
    }

    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateToc, 300);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    console.log('[AI Chat TOC] DOM 监听已启动');
  }

  // ========== 监听URL变化（SPA路由） ==========
  // content script 在 isolated world，无法 patch 主世界的 history API；
  // 改用低频轮询 + popstate，开销远低于原先的 body MutationObserver
  function watchUrlChange() {
    let lastUrl = location.href;

    const onUrlChange = () => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      console.log('[AI Chat TOC] 检测到页面切换，重新加载目录');
      setTimeout(() => {
        updateToc();
        if (observer) observer.disconnect();
        startObserver();
      }, 1000);
    };

    window.addEventListener('popstate', onUrlChange);
    setInterval(onUrlChange, 1000);
  }

  // ========== 初始化 ==========
  function init() {
    currentAdapter = detectPlatform();
    if (!currentAdapter) {
      console.log('[AI Chat TOC] 未检测到支持的平台');
      return;
    }

    const waitForContent = setInterval(() => {
      const messages = currentAdapter.getUserMessages();
      const container = currentAdapter.getChatContainer();

      if (container || messages.length > 0) {
        clearInterval(waitForContent);
        createSidebar();
        updateToc();
        startObserver();
        watchUrlChange();
        console.log('[AI Chat TOC] 初始化完成');
      }
    }, 500);

    setTimeout(() => clearInterval(waitForContent), 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
