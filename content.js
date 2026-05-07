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

  // 从节点上尽力抠出文件名：aria-label / alt / data-testid / download / 文本内容
  function pickFileName(el) {
    const candidates = [
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('alt'),
      el.getAttribute?.('data-testid'),
      el.getAttribute?.('data-test-id'), // Gemini 用 data-test-id（带连字符）
      el.getAttribute?.('download'),
      el.getAttribute?.('title'),
      el.textContent?.trim(),
    ];
    for (const v of candidates) {
      if (!v) continue;
      if (v.length > 80 || v.includes('\n')) continue;
      if (/\.[a-z0-9]{1,8}($|\s)/i.test(v)) return v.trim();
    }
    return '';
  }

  // 从一个文件卡片节点抠出最完整的文件名
  // 优先：button[aria-label] → name + type 组合 → pickFileName 兜底
  function extractFileName(fileBlock) {
    const btn = fileBlock.querySelector('button[aria-label], [aria-label*="."]');
    if (btn) {
      const label = btn.getAttribute('aria-label');
      if (label && /\.[a-z0-9]{1,8}$/i.test(label.trim())) return label.trim();
    }
    const nameEl = fileBlock.querySelector('.new-file-name, [class*="file-name" i], [class*="filename" i]');
    const typeEl = fileBlock.querySelector('.new-file-type, [class*="file-type" i]');
    if (nameEl?.textContent) {
      let name = nameEl.textContent.trim();
      const type = typeEl?.textContent?.trim();
      if (type && !name.toLowerCase().endsWith('.' + type.toLowerCase())) {
        name = `${name}.${type.toLowerCase()}`;
      }
      return name;
    }
    return pickFileName(fileBlock);
  }

  // 没文本时尝试识别附件（图片/文件），生成占位符
  // 顺序：先识别文件卡片（含文件图标 img），再识别真正的图片，避免文件图标被误判
  function describeAttachments(el) {
    const parts = [];

    // 1. 文件卡片（Gemini: data-test-id="uploaded-file" / .new-file-preview-container）
    const fileBlocks = Array.from(el.querySelectorAll(
      '[data-test-id="uploaded-file"], [data-testid="uploaded-file"], ' +
      '[class*="new-file-preview" i], [class*="attachment" i], [class*="file-card" i]'
    ));
    const fileNames = fileBlocks.map(extractFileName).filter(Boolean);
    const fileCount = Math.max(fileBlocks.length, fileNames.length);

    // 额外：a[download] 这种独立链接（不在卡片里）
    const dlLinks = Array.from(el.querySelectorAll('a[download]'))
      .filter(a => !fileBlocks.some(f => f.contains(a)));
    dlLinks.forEach(a => {
      const n = pickFileName(a);
      if (n) fileNames.push(n);
    });
    const totalFiles = fileCount + dlLinks.length;

    if (totalFiles > 0) {
      if (totalFiles === 1) {
        parts.push(fileNames[0] ? `[附件: ${fileNames[0]}]` : '[附件]');
      } else {
        const head = fileNames[0] ? `: ${fileNames[0]}` : '';
        parts.push(`[附件 ×${totalFiles}${head}${fileNames.length > 1 ? ' 等' : ''}]`);
      }
    }

    // 2. 真正的图片：排除头像、文件图标，且不在文件卡片内部
    const allImgs = Array.from(el.querySelectorAll(
      'img:not([alt="user avatar" i]):not([class*="avatar" i])' +
      ':not([data-test-id="new-file-icon"]):not([data-testid="new-file-icon"])' +
      ':not([class*="file-icon" i])'
    ));
    const imgs = allImgs.filter(img => !fileBlocks.some(f => f.contains(img)));

    if (imgs.length > 0) {
      const names = [];
      imgs.forEach(img => {
        const n = pickFileName(img) || pickFileName(img.closest('[data-testid], [data-test-id]') || img);
        if (n) names.push(n);
      });
      if (imgs.length === 1) {
        parts.push(names[0] ? `[图片: ${names[0]}]` : '[图片]');
      } else {
        const head = names[0] ? `: ${names[0]}` : '';
        parts.push(`[图片 ×${imgs.length}${head}${names.length > 1 ? ' 等' : ''}]`);
      }
    }

    return parts.join(' ');
  }

  // 包一层：合并文字 + 附件描述
  // - 仅文字 → 文字
  // - 仅附件 → 附件描述
  // - 文字+附件 → "文字 [图片]" / "文字 [附件: x.pdf]"
  function extractText(adapter, el) {
    const raw = adapter._rawText(el).trim();
    const att = describeAttachments(el);
    if (raw && att) return `${raw} ${att}`;
    return raw || att;
  }

  // ========== 平台适配器 ==========
  // 每个平台的选择器都按「最稳定 → 兜底」排序，AI 站改版时优先调整这里
  const platformAdapters = {
    chatgpt: {
      name: 'ChatGPT',
      hostMatch: /chatgpt\.com|chat\.openai\.com/,
      scrollOffset: 80,
      userMsgSelectors: [
        '[data-message-author-role="user"]',
        'article[data-testid^="conversation-turn"] [data-message-author-role="user"]',
      ],
      textSelectors: ['.whitespace-pre-wrap', '[class*="whitespace-pre"]'],
      containerSelectors: ['[role="presentation"]', 'main'],
      getUserMessages() { return querySelectorAllFallback(this.userMsgSelectors); },
      _rawText(el) {
        const textEl = querySelectorFallback(this.textSelectors, el);
        return textEl ? textEl.textContent : el.textContent;
      },
      getMessageText(el) { return extractText(this, el); },
      getChatContainer() { return querySelectorFallback(this.containerSelectors); },
    },

    claude: {
      name: 'Claude',
      hostMatch: /claude\.ai/,
      scrollOffset: 88,
      // 兜底用：仅文字消息时旧选择器仍然命中
      userMsgSelectors: [
        '[data-testid="user-message"]',
        'div[data-test-render-count] [data-testid="user-message"]',
      ],
      // 文字提取限定在用户气泡内，避免抓到 sr-only 标签或按钮文字
      textSelectors: ['[data-testid="user-message"]', '.whitespace-pre-wrap'],
      containerSelectors: [
        '[data-testid="conversation-turn-wrapper"]',
        'main',
      ],
      // 用户回合 wrapper：同时包住图片块和文字气泡，覆盖「纯图片」消息
      // 通过两类探针元素反查到外层 .mb-1.mt-6.group，再去重
      getUserMessages() {
        const wrappers = new Set();
        const probes = document.querySelectorAll(
          '[data-user-message-bubble="true"], [data-testid="user-message"], .flex.flex-wrap.justify-end'
        );
        probes.forEach(p => {
          // .justify-end 在助手侧不会出现，但稳妥起见用 closest 找用户回合 wrapper
          const turn = p.closest('.mb-1.mt-6.group') || p.closest('[class*="mb-1"][class*="mt-6"]');
          if (turn) wrappers.add(turn);
        });
        if (wrappers.size > 0) return Array.from(wrappers);
        // 兜底：旧选择器
        return querySelectorAllFallback(this.userMsgSelectors);
      },
      _rawText(el) {
        const textEl = querySelectorFallback(this.textSelectors, el);
        return textEl ? textEl.textContent : '';
      },
      getMessageText(el) { return extractText(this, el); },
      getChatContainer() {
        const turn = document.querySelector('[data-testid="conversation-turn-wrapper"]');
        if (turn?.parentElement) return turn.parentElement;
        return document.querySelector('main');
      },
    },

    gemini: {
      name: 'Gemini',
      hostMatch: /gemini\.google\.com/,
      scrollOffset: 96,
      // 优先匹配整个 <user-query> 自定义元素：同时包住图片预览和文字气泡，
      // 覆盖纯图片 / 文字+图片 / 纯文字三种情况；后两个是兼容旧版的兜底
      userMsgSelectors: [
        'user-query',
        '.query-text',
        '[data-text-query]',
      ],
      containerSelectors: ['.conversation-container', 'chat-window', 'main'],
      getUserMessages() { return querySelectorAllFallback(this.userMsgSelectors); },
      _rawText(el) {
        // 克隆后剥离 sr-only / aria-hidden 节点，避免抓到 "You said" 标签和图标按钮
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.cdk-visually-hidden, .sr-only, [aria-hidden="true"]').forEach(n => n.remove());
        return clone.textContent.replace(/^you\s*said[:：]?\s*/i, '');
      },
      getMessageText(el) { return extractText(this, el); },
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
  let observedContainer = null;
  let lastSeenCount = -1;
  let lastFingerprint = '';
  let tocItems = []; // [{ msgEl, itemEl }] —— 委托事件时按 index 反查
  let activeItem = null; // 当前高亮中的目录条目（O(1) 切换 active 用）

  const HIDE_DELAY = 400;
  const WATCHDOG_INTERVAL = 500; // 看门狗轮询间隔，覆盖虚拟列表/容器替换场景

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

    // 搜索（带 debounce，避免快速键入时频繁遍历）
    const searchInput = sidebar.querySelector('.toc-search-input');
    let searchTimer = null;
    searchInput.addEventListener('input', (e) => {
      const v = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => filterTocItems(v), 100);
    });

    // 目录条目事件委托：click/mouseover/mouseout 各挂一次，省去逐项绑定
    const tocList = sidebar.querySelector('.toc-list');
    tocList.addEventListener('click', (e) => {
      const itemEl = e.target.closest('.toc-item');
      if (!itemEl) return;
      const idx = +itemEl.dataset.index;
      const data = tocItems[idx];
      if (data?.msgEl?.isConnected) scrollToMessage(data.msgEl, idx);
    });
    tocList.addEventListener('mouseover', (e) => {
      const itemEl = e.target.closest('.toc-item');
      if (!itemEl || itemEl.contains(e.relatedTarget)) return;
      const data = tocItems[+itemEl.dataset.index];
      if (data?.msgEl?.isConnected) data.msgEl.classList.add('toc-highlight');
    });
    tocList.addEventListener('mouseout', (e) => {
      const itemEl = e.target.closest('.toc-item');
      if (!itemEl || itemEl.contains(e.relatedTarget)) return;
      const data = tocItems[+itemEl.dataset.index];
      if (data?.msgEl?.isConnected) data.msgEl.classList.remove('toc-highlight');
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

  // 指纹：消息数 + 首尾文本片段，足够区分增删与虚拟列表内容替换；
  // 流式回复期间用户消息数和首尾不变，指纹稳定 → 跳过整次重建
  function computeFingerprint(messages) {
    if (messages.length === 0) return '0';
    const first = currentAdapter.getMessageText(messages[0]).slice(0, 50);
    const last = messages.length > 1
      ? currentAdapter.getMessageText(messages[messages.length - 1]).slice(0, 50)
      : first;
    return `${messages.length}|${first}|${last}`;
  }

  // ========== 提取对话并更新目录 ==========
  function updateToc() {
    if (!currentAdapter || !sidebar) return;

    const messages = currentAdapter.getUserMessages();
    const fp = computeFingerprint(messages);
    if (fp === lastFingerprint) return; // 指纹未变，跳过重建
    lastFingerprint = fp;

    const tocList = sidebar.querySelector('.toc-list');
    const tocCount = sidebar.querySelector('.toc-count');

    tocCount.textContent = `${messages.length} 条`;
    activeItem = null;
    tocItems = [];

    if (messages.length === 0) {
      tocList.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.textContent = '暂无对话内容';
      tocList.appendChild(empty);
      updateBadge(0);
      return;
    }

    // 用 DocumentFragment 一次性 attach，减少 layout 抖动
    const frag = document.createDocumentFragment();
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
      frag.appendChild(item);

      tocItems[index] = { msgEl, itemEl: item };
    });

    tocList.replaceChildren(frag);
    updateBadge(messages.length);
  }

  function updateBadge(count) {
    let badge = triggerZone.querySelector('.trigger-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'trigger-badge';
      triggerZone.appendChild(badge);
    }
    badge.textContent = count;
  }

  // 沿父链找到真正可滚动的祖先（AI 站通常滚动发生在内层容器而非 window）
  function findScrollableAncestor(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      const overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return null; // 没有内层滚动容器，回退到 window
  }

  // ========== 跳转到指定消息 ==========
  function scrollToMessage(el, index) {
    const offset = currentAdapter.scrollOffset ?? 80;
    const scroller = findScrollableAncestor(el);

    if (scroller) {
      const elRect = el.getBoundingClientRect();
      const scRect = scroller.getBoundingClientRect();
      const target = scroller.scrollTop + (elRect.top - scRect.top) - offset;
      scroller.scrollTo({ top: target, behavior: 'smooth' });
    } else {
      const target = window.scrollY + el.getBoundingClientRect().top - offset;
      window.scrollTo({ top: target, behavior: 'smooth' });
    }

    el.classList.add('toc-flash');
    setTimeout(() => el.classList.remove('toc-flash'), 1500);

    // 仅切换两个节点的 active class，避免遍历整张表
    if (activeItem) activeItem.classList.remove('active');
    const next = tocItems[index]?.itemEl;
    if (next) {
      next.classList.add('active');
      activeItem = next;
    }

    // 点目录项滚动到顶部时，Gemini 这类站点会触发加载历史导致 DOM 换批；
    // 主动安排几次复核，赶在用户感知到延迟前刷新目录
    [200, 600, 1200].forEach(d => setTimeout(reconcileToc, d));
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
  // 幂等：传入相同 container 时不会重复挂载；container 被替换时自动迁移
  function startObserver() {
    const container = currentAdapter.getChatContainer();
    if (!container) {
      setTimeout(startObserver, 1000);
      return;
    }
    if (container === observedContainer && observer) return;

    if (observer) observer.disconnect();
    observedContainer = container;

    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateToc, 300);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    bindScrollTrigger();
    console.log('[AI Chat TOC] DOM 监听已挂载到新容器');
  }

  // ========== 一致性检查：容器/消息数/observer 是否过期 ==========
  // 看门狗、滚动事件共用，被 throttle 防止短时间重复触发
  let lastCheckAt = 0;
  function reconcileToc() {
    if (!currentAdapter || !sidebar) return;

    const container = currentAdapter.getChatContainer();
    if (container && container !== observedContainer) {
      console.log('[AI Chat TOC] 聊天容器已被替换，重挂监听');
      lastFingerprint = '';
      startObserver();
      updateToc();
      lastSeenCount = currentAdapter.getUserMessages().length;
      bindScrollTrigger(); // 容器变了，scroll 监听也要迁
      return;
    }

    const count = currentAdapter.getUserMessages().length;
    if (count !== lastSeenCount) {
      lastSeenCount = count;
      updateToc();
    }
  }

  function startWatchdog() {
    setInterval(reconcileToc, WATCHDOG_INTERVAL);
  }

  // ========== 滚动触发：加载历史一定伴随滚动 ==========
  // 在聊天容器的真正可滚动祖先上挂 scroll，throttle 150ms；
  // 滚到顶部加载旧消息时几乎立即响应，不用等下一个看门狗 tick
  let scrollBoundOn = null; // 已绑定 scroll 的元素，避免重复挂
  function bindScrollTrigger() {
    if (!observedContainer) return;
    const scroller = findScrollableAncestor(observedContainer)
      || findScrollableAncestor(observedContainer.firstElementChild || observedContainer);
    if (!scroller || scroller === scrollBoundOn) return;

    if (scrollBoundOn) scrollBoundOn.removeEventListener('scroll', onScrollTick);
    scroller.addEventListener('scroll', onScrollTick, { passive: true });
    scrollBoundOn = scroller;
  }

  function onScrollTick() {
    const now = Date.now();
    if (now - lastCheckAt < 150) return;
    lastCheckAt = now;
    reconcileToc();
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
      observedContainer = null; // 强制重新解析容器
      lastSeenCount = -1;
      lastFingerprint = ''; // 切换会话后必须重建
      setTimeout(() => {
        startObserver();
        updateToc();
      }, 1000);
    };

    window.addEventListener('popstate', onUrlChange);
    setInterval(onUrlChange, 1000);
  }

  // ========== 调试报告 ==========
  // 暴露在 window.__AI_CHAT_TOC_DEBUG__，本地生成 JSON、复制到剪贴板，不发任何网络请求
  function safeCall(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function getDomPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 12) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += `#${node.id}`;
        parts.unshift(part);
        break;
      }
      const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      const testId = node.getAttribute('data-testid') || node.getAttribute('data-test-id');
      if (testId) part += `[data-testid="${testId}"]`;
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (sameTag.length > 1) {
          const idx = sameTag.indexOf(node) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function collectAttrCandidates(el) {
    const out = [];
    safeCall(() => {
      const nodes = el.querySelectorAll('[aria-label], [title], [data-testid], [data-test-id]');
      const seen = new Set();
      Array.from(nodes).slice(0, 30).forEach(n => {
        const entry = {
          tag: n.tagName.toLowerCase(),
          ariaLabel: n.getAttribute('aria-label') || null,
          title: n.getAttribute('title') || null,
          dataTestid: n.getAttribute('data-testid') || n.getAttribute('data-test-id') || null,
        };
        const key = JSON.stringify(entry);
        if (!seen.has(key)) { seen.add(key); out.push(entry); }
      });
    }, null);
    return out;
  }

  function collectImageCandidates(el) {
    return safeCall(() => Array.from(el.querySelectorAll('img')).slice(0, 20).map(img => ({
      src: (img.getAttribute('src') || '').slice(0, 200),
      alt: img.getAttribute('alt') || null,
      ariaLabel: img.getAttribute('aria-label') || null,
      className: (img.getAttribute('class') || '').slice(0, 200),
      width: img.naturalWidth || img.width || null,
      height: img.naturalHeight || img.height || null,
      domPath: getDomPath(img),
    })), []);
  }

  function collectFileCandidates(el) {
    return safeCall(() => {
      const sel = '[data-test-id="uploaded-file"], [data-testid="uploaded-file"], ' +
        '[class*="new-file-preview" i], [class*="attachment" i], [class*="file-card" i], a[download]';
      return Array.from(el.querySelectorAll(sel)).slice(0, 20).map(node => ({
        tag: node.tagName.toLowerCase(),
        className: (node.getAttribute('class') || '').slice(0, 200),
        ariaLabel: node.getAttribute('aria-label') || null,
        dataTestid: node.getAttribute('data-testid') || node.getAttribute('data-test-id') || null,
        download: node.getAttribute('download') || null,
        text: (node.textContent || '').trim().slice(0, 200),
        extractedName: safeCall(() => extractFileName(node), ''),
        domPath: getDomPath(node),
      }));
    }, []);
  }

  function buildDebugReport() {
    const adapter = currentAdapter;
    const messages = safeCall(() => adapter ? adapter.getUserMessages() : [], []);
    const msgArr = Array.from(messages || []);

    const messagesReport = msgArr.map((el, index) => safeCall(() => {
      const raw = safeCall(() => (el.textContent || '').trim(), '');
      const tocText = safeCall(() => adapter.getMessageText(el), '');
      const outer = safeCall(() => el.outerHTML || '', '');
      return {
        index,
        textPreview: raw.slice(0, 300),
        textLength: raw.length,
        tocText,
        domPath: getDomPath(el),
        outerHTMLSample: outer.slice(0, 4000),
        outerHTMLTruncated: outer.length > 4000,
        imageCandidates: collectImageCandidates(el),
        fileCandidates: collectFileCandidates(el),
        attrCandidates: collectAttrCandidates(el),
      };
    }, { index, error: 'extraction_failed' }));

    return {
      generatedAt: new Date().toISOString(),
      url: safeCall(() => location.href, ''),
      hostname: safeCall(() => location.hostname, ''),
      platform: adapter ? adapter.name : null,
      userAgent: safeCall(() => navigator.userAgent, ''),
      messageCount: msgArr.length,
      observedContainerPath: safeCall(() => getDomPath(observedContainer), ''),
      chatContainerPath: safeCall(() => getDomPath(adapter && adapter.getChatContainer()), ''),
      messages: messagesReport,
    };
  }

  // 通过 CustomEvent 与主世界的 debug-bridge.js 通信
  // 隔离 world 的 window 对页面控制台不可见，所以必须走桥接
  document.addEventListener('__AI_CHAT_TOC_DEBUG_REQ__', (e) => {
    const detail = e.detail || {};
    const id = detail.id;
    const action = detail.action;
    let payload = null;
    let error = null;
    try {
      const report = buildDebugReport();
      if (action === 'copyReport') {
        const json = JSON.stringify(report, null, 2);
        console.log('[AI Chat TOC] 调试报告:', report);
        console.log(`[AI Chat TOC] 报告长度: ${json.length} 字符`);
        payload = { report, json };
      } else {
        payload = { report };
      }
    } catch (err) {
      error = (err && err.message) || String(err);
      console.error('[AI Chat TOC] 调试报告生成失败:', err);
    }
    document.dispatchEvent(new CustomEvent('__AI_CHAT_TOC_DEBUG_RES__', {
      detail: { id, payload, error },
    }));
  });

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
        startWatchdog();
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
