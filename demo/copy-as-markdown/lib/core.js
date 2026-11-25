// Copy as Markdown: pure conversion logic, no DOM and no chrome.* calls, so it is unit-tested in Node.
// Input is the plain tree returned by content/extract.js ({ t: tag, a: attributes, c: children },
// text as strings). Output is CommonMark / GitHub-flavoured Markdown: headings, paragraphs, line
// breaks, bold, italic, strikethrough, inline code, fenced code blocks with language, links and
// images as absolute URLs, nested bullet / numbered / task lists, block quotes, tables, rules.
'use strict';
(function (root) {
  const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'figure', 'figcaption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr',
    'td', 'th', 'caption', 'dl', 'dt', 'dd', 'address', 'details', 'summary', 'form', 'fieldset', 'center', 'hgroup', 'body', 'html']);
  const BAD_SCHEME = /^\s*(javascript|vbscript|data):/i;

  const isEl = n => n && typeof n === 'object';
  const collapse = s => String(s).replace(/[ \t\n\r\f\u00a0]+/g, ' ');
  function escText(s) {
    return s.replace(/([\\`*_[\]])/g, '\\$1').replace(/<(?=[A-Za-z/!?])/g, '\\<');
  }
  function escLineStart(line) {
    return line
      .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
      .replace(/^>/, '\\>')
      .replace(/^([-+])(?=\s)/, '\\$1')
      .replace(/^(-{3,}|={3,})\s*$/, m => '\\' + m)
      .replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2');
  }
  function resolve(href, base) {
    try { return new URL(href, base || undefined).href; } catch (e) { return String(href); }
  }
  const fmtUrl = u => u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E');
  function rawText(n) {
    if (!isEl(n)) return String(n);
    if (n.t === 'br') return '\n';
    return (n.c || []).map(rawText).join('');
  }
  function wrapMark(mark, inner) {
    const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2]) return inner;
    return m[1] + mark + m[2] + mark + m[3];
  }

  function makeRenderer(opts) {
    const base = opts.base || '';
    const images = opts.images !== false;
    const stats = { links: 0, images: 0, headings: 0, lists: 0, tables: 0, codeBlocks: 0, quotes: 0 };

    function inlineKids(n, ctx) { return (n.c || []).map(ch => inline(ch, ctx)).join(''); }

    function inline(n, ctx) {
      if (!isEl(n)) return escText(collapse(n));
      const t = n.t, a = n.a || {};
      switch (t) {
        case 'br': return '\n';
        case 'strong': case 'b': return ctx.strong ? inlineKids(n, ctx) : wrapMark('**', inlineKids(n, { ...ctx, strong: true }));
        case 'em': case 'i': return ctx.em ? inlineKids(n, ctx) : wrapMark('*', inlineKids(n, { ...ctx, em: true }));
        case 'del': case 's': case 'strike': return ctx.del ? inlineKids(n, ctx) : wrapMark('~~', inlineKids(n, { ...ctx, del: true }));
        case 'code': case 'kbd': case 'samp': case 'tt': {
          const text = collapse(rawText(n));
          if (!text.trim()) return text ? ' ' : '';
          const runs = text.match(/`+/g) || [];
          const fence = '`'.repeat(Math.max(0, ...runs.map(r => r.length)) + 1);
          const pad = /^`|`$/.test(text) ? ' ' : '';
          return fence + pad + text + pad + fence;
        }
        case 'a': {
          const inner = inlineKids(n, { ...ctx, link: true });
          if (!inner.trim()) return inner;
          const href = a.href;
          if (ctx.link || !href || BAD_SCHEME.test(href)) return inner;
          const abs = resolve(href, base);
          stats.links++;
          const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
          const label = m[2].replace(/\n/g, ' ');
          if (label === escText(abs) && /^https?:\/\//.test(abs)) return m[1] + '<' + fmtUrl(abs) + '>' + m[3];
          return m[1] + '[' + label + '](' + fmtUrl(abs) + ')' + m[3];
        }
        case 'img': {
          if (!images) return '';
          let src = a.src;
          if (!src || /^data:/i.test(src)) src = a['data-src'];
          if (!src || BAD_SCHEME.test(src)) return '';
          stats.images++;
          const alt = escText(collapse(a.alt || '').trim());
          return '![' + alt + '](' + fmtUrl(resolve(src, base)) + ')';
        }
        case 'input': return '';
        default:
          if (BLOCK.has(t)) return ' ' + inlineKids(n, ctx) + ' ';
          return inlineKids(n, ctx);
      }
    }

    function finishPara(buf) {
      const lines = buf.split('\n').map(l => l.replace(/ {2,}/g, ' ').trim());
      const paras = lines.join('\n').split(/\n{2,}/).map(p => p.replace(/^\n+|\n+$/g, '')).filter(Boolean);
      return paras.map(p => p.split('\n').map(escLineStart).join('  \n')).join('\n\n');
    }

    function blocks(nodes, ctx) {
      const out = [];
      let buf = '';
      const flush = () => { const p = finishPara(buf); if (p) out.push(p); buf = ''; };
      for (const n of nodes || []) {
        if (isEl(n) && BLOCK.has(n.t)) { flush(); out.push(...block(n, ctx)); }
        else buf += inline(n, ctx);
      }
      flush();
      return out.filter(b => b && b.trim());
    }

    function heading(n, ctx) {
      const level = +n.t[1];
      const text = inlineKids(n, ctx).replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
      if (!text) return [];
      stats.headings++;
      return ['#'.repeat(level) + ' ' + text];
    }

    function codeBlock(n) {
      let text = rawText(n).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
      if (!text.trim()) return [];
      const codeKid = (n.c || []).find(c => isEl(c) && c.t === 'code');
      const cls = ((n.a && n.a.class) || '') + ' ' + ((codeKid && codeKid.a && codeKid.a.class) || '');
      const lm = cls.match(/(?:^|\s)(?:language|lang)-([\w+#.-]+)/i);
      const runs = text.match(/^`{3,}/gm) || [];
      const fence = '`'.repeat(Math.max(3, ...runs.map(r => r.length + 1)));
      stats.codeBlocks++;
      return [fence + (lm ? lm[1].toLowerCase() : '') + '\n' + text + '\n' + fence];
    }

    function findCheckbox(nodes, depth) {
      for (const c of nodes || []) {
        if (!isEl(c)) { if (String(c).trim()) return null; continue; }
        if (c.t === 'input') return c;
        if (depth < 2) { const r = findCheckbox(c.c, depth + 1); if (r !== undefined) return r; }
        return null;
      }
      return undefined;
    }

    function list(n, ctx) {
      const ordered = n.t === 'ol';
      let next = parseInt(n.a && n.a.start, 10); if (!Number.isFinite(next)) next = 1;
      const items = [];
      for (const ch of n.c || []) {
        if (!isEl(ch)) continue;
        if (ch.t === 'ul' || ch.t === 'ol') {
          const sub = list(ch, ctx);
          if (!sub) continue;
          if (items.length) items[items.length - 1] += '\n' + sub.split('\n').map(l => (l ? '    ' + l : '')).join('\n');
          else items.push(sub);
          continue;
        }
        if (ch.t !== 'li') continue;
        let num = next;
        if (ordered && ch.a && /^-?\d+$/.test(ch.a.value || '')) num = parseInt(ch.a.value, 10);
        next = num + 1;
        const parts = blocks(ch.c, ctx);
        let content = parts.map((b, i) => (i === 0 ? '' : (/^(?:-|\d+\.) /.test(b) ? '\n' : '\n\n')) + b).join('');
        const box = findCheckbox(ch.c, 0);
        if (box && box.a && box.a.type === 'checkbox') content = (box.a.checked ? '[x]' : '[ ]') + (content ? ' ' + content : '');
        if (!content.trim()) continue;
        const marker = ordered ? num + '.' : '-';
        const indent = ' '.repeat(marker.length + 1);
        const lines = content.split('\n');
        items.push(marker + ' ' + lines[0] + lines.slice(1).map(l => '\n' + (l ? indent + l : '')).join(''));
      }
      if (!items.length) return '';
      stats.lists++;
      return items.join('\n');
    }

    function rowsOf(n) {
      if (n.t === 'tr') return [n];
      const rows = [];
      for (const c of n.c || []) {
        if (!isEl(c)) continue;
        if (c.t === 'tr') rows.push(c);
        else if (c.t === 'thead' || c.t === 'tbody' || c.t === 'tfoot') rows.push(...rowsOf(c));
      }
      return rows;
    }

    function table(n, ctx) {
      const rows = rowsOf(n).map(tr => {
        const cells = [];
        for (const c of tr.c || []) {
          if (!isEl(c) || (c.t !== 'td' && c.t !== 'th')) continue;
          const text = collapse(inlineKids(c, ctx).replace(/\n/g, ' ')).trim().replace(/\|/g, '\\|');
          cells.push(text);
          const span = Math.min(parseInt(c.a && c.a.colspan, 10) || 1, 50);
          for (let i = 1; i < span; i++) cells.push('');
        }
        return cells;
      }).filter(r => r.length && r.some(x => x));
      if (!rows.length) return [];
      const cols = Math.max(...rows.map(r => r.length));
      const line = r => '| ' + Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ') + ' |';
      stats.tables++;
      const caption = (n.c || []).find(c => isEl(c) && c.t === 'caption');
      const out = [line(rows[0]), '|' + Array(cols).fill(' --- ').join('|') + '|', ...rows.slice(1).map(line)].join('\n');
      const cap = caption ? finishPara(inlineKids(caption, ctx)) : '';
      return cap ? [cap, out] : [out];
    }

    function block(n, ctx) {
      switch (n.t) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return heading(n, ctx);
        case 'hr': return ['---'];
        case 'pre': return codeBlock(n);
        case 'blockquote': {
          const inner = blocks(n.c, ctx).join('\n\n');
          if (!inner) return [];
          stats.quotes++;
          return [inner.split('\n').map(l => (l ? '> ' + l : '>')).join('\n')];
        }
        case 'ul': case 'ol': { const l = list(n, ctx); return l ? [l] : []; }
        case 'table': case 'thead': case 'tbody': case 'tfoot': case 'tr': return table(n, ctx);
        case 'caption': return [];
        case 'dt': case 'summary': {
          const text = finishPara(inlineKids(n, { ...ctx, strong: true }));
          return text ? [wrapMark('**', text.replace(/ {2}\n/g, ' '))] : [];
        }
        default: return blocks(n.c, ctx);
      }
    }

    function render(tree) {
      if (!tree) return '';
      if (isEl(tree) && BLOCK.has(tree.t)) return block(tree, {}).join('\n\n');
      return finishPara(inline(tree, {}));
    }
    return { render, stats };
  }

  function plainWords(tree) {
    const text = [];
    (function go(n) {
      if (!isEl(n)) { text.push(String(n)); return; }
      if (n.t === 'img') return;
      text.push(' '); (n.c || []).forEach(go); text.push(' ');
    })(tree || '');
    const m = text.join('').match(/[\p{L}\p{N}][\p{L}\p{N}'’_.-]*/gu);
    return m ? m.length : 0;
  }

  function toMarkdown(data, opts) {
    opts = opts || {};
    const r = makeRenderer({ base: data && data.url, images: opts.images !== false });
    let body = data && data.tree ? r.render(data.tree) : '';
    body = body.replace(/[ \t]+$/gm, m => (m === '  ' ? m : '')).trim();
    let md = body;
    if (body && opts.source !== false && data && data.url && /^https?:/i.test(data.url)) {
      const title = collapse(data.title || '').trim();
      const link = title ? '[' + escText(title) + '](' + fmtUrl(data.url) + ')' : '<' + fmtUrl(data.url) + '>';
      md = 'Source: ' + link + '\n\n' + body;
    }
    return { markdown: md ? md + '\n' : '', stats: { ...r.stats, words: plainWords(data && data.tree) }, empty: !body };
  }

  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function summary(data, result) {
    if (result.empty) {
      return data && data.source === 'selection'
        ? 'The selection has no text that can be copied. Text inside form fields and embedded frames can\'t be read.'
        : 'No text found on this page.';
    }
    const s = result.stats;
    const parts = [plural(s.words, 'word')];
    if (s.headings) parts.push(plural(s.headings, 'heading'));
    if (s.links) parts.push(plural(s.links, 'link'));
    if (s.images) parts.push(plural(s.images, 'image'));
    if (s.lists) parts.push(plural(s.lists, 'list'));
    if (s.tables) parts.push(plural(s.tables, 'table'));
    if (s.codeBlocks) parts.push(plural(s.codeBlocks, 'code block'));
    const what = {
      selection: 'Your selection',
      article: 'Nothing was selected, so this is the page\'s main article',
      main: 'Nothing was selected, so this is the page\'s main content',
      body: 'Nothing was selected, so this is the whole page without menus, sidebars and footers',
    }[data.source] || 'Converted';
    return what + ': ' + parts.join(', ') + '.' + (data.truncated ? ' Very long, so only the first part was read.' : '');
  }

  function fileName(title) {
    const base = String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    return (base || 'selection') + '.md';
  }

  const api = { toMarkdown, summary, fileName, escText, resolve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CopyMarkdownCore = api;
})(typeof self !== 'undefined' ? self : this);
