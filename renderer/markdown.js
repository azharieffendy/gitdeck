'use strict';
// GitDeck Markdown renderer for pull request text. Everything is HTML-escaped first;
// the only markup produced is a fixed set of tags, and links are limited to http(s).
// Raw HTML in the source is shown as text. Exposed as window.GitMarkdown.
(function () {
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Inline markup on already-escaped text. Code spans are set aside so their
  // contents are not formatted.
  function inline(escaped) {
    const codes = [];
    let s = escaped.replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/!?\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
      (_m, text, url) => '<a href="' + url + '" class="md-link">' + (text || url) + '</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => '<code>' + codes[Number(i)] + '</code>');
  }

  function render(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
    const out = [];
    let para = [], list = null; // list: {tag, items}
    const flushPara = () => { if (para.length) out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; };
    const flushList = () => {
      if (list) out.push('<' + list.tag + '>' + list.items.map((i) => '<li>' + i + '</li>').join('') + '</' + list.tag + '>');
      list = null;
    };
    const flush = () => { flushPara(); flushList(); };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*(```|~~~)/);
      if (fence) {
        flush();
        const code = [];
        while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i]);
        out.push('<pre class="md-code"><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
        continue;
      }
      const esc = escapeHtml(line);
      let m;
      if (!line.trim()) { flush(); continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flush();
        out.push('<h' + m[1].length + '>' + inline(escapeHtml(m[2])) + '</h' + m[1].length + '>');
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush(); out.push('<hr>');
      } else if ((m = esc.match(/^&gt;\s?(.*)$/))) {
        flush(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>');
      } else if ((m = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
        flushPara();
        const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [] };
        const task = m[2].match(/^\[([ xX])\]\s+(.*)$/);
        list.items.push(task
          ? (task[1] === ' ' ? '&#9744; ' : '&#9745; ') + inline(escapeHtml(task[2]))
          : inline(escapeHtml(m[2])));
      } else {
        flushList();
        para.push(esc);
      }
    }
    flush();
    return out.join('\n');
  }

  const api = { render, escapeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.GitMarkdown = api;
})();
