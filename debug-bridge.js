// 运行在页面 main world，把调试 API 暴露给 DevTools 控制台
// 通过 CustomEvent 与 content script（isolated world）通信
(function () {
  'use strict';
  if (window.__AI_CHAT_TOC_DEBUG__) return;

  const REQ = '__AI_CHAT_TOC_DEBUG_REQ__';
  const RES = '__AI_CHAT_TOC_DEBUG_RES__';
  let seq = 0;

  function call(action) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        document.removeEventListener(RES, handler);
        reject(new Error('AI Chat TOC debug bridge timeout (扩展未加载或被禁用?)'));
      }, 5000);
      function handler(e) {
        if (!e.detail || e.detail.id !== id) return;
        clearTimeout(timer);
        document.removeEventListener(RES, handler);
        if (e.detail.error) reject(new Error(e.detail.error));
        else resolve(e.detail.payload);
      }
      document.addEventListener(RES, handler);
      document.dispatchEvent(new CustomEvent(REQ, { detail: { id, action } }));
    });
  }

  async function writeClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function copyReport() {
    const data = await call('copyReport');
    if (!data || !data.json) return data && data.report;
    const ok = await writeClipboard(data.json);
    if (ok) console.log(`[AI Chat TOC] 已复制 ${data.json.length} 字符到剪贴板`);
    else console.warn('[AI Chat TOC] 复制失败，console 中已打印报告对象');
    return data.report;
  }

  async function getReport() {
    const data = await call('getReport');
    return data && data.report;
  }

  Object.defineProperty(window, '__AI_CHAT_TOC_DEBUG__', {
    value: Object.freeze({
      version: 1,
      copyReport,
      getReport,
    }),
    writable: false,
    configurable: false,
  });
})();
