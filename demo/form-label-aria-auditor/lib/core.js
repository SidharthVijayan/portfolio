// Form Label & ARIA Auditor core: pure functions, no DOM, no network. Shared by the popup and Node tests.
// Works out each form field's and button's accessible name in the order browsers use (a simplified form of the
// W3C Accessible Name computation): aria-labelledby, aria-label, <label>, button text / value / alt, title, placeholder.
// Flags fields and buttons with no name (WCAG 1.3.1, 4.1.2), weak names (placeholder or title only), names that
// don't contain the visible label (WCAG 2.5.3), focusable controls inside aria-hidden, broken ARIA ID references,
// duplicate referenced ids and <label for> pointing at nothing. A helper, not a full accessibility audit.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const norm = s => clean(s).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();
  const q = s => `"${clean(s).length > 60 ? clean(s).slice(0, 59) + '…' : clean(s)}"`;
  const RANK = { error: 0, warn: 1, ok: 2 };
  const DEFAULT_BUTTON = { submit: 'Submit', reset: 'Reset' };

  function describe(c) {
    let s = `<${c.tag}`;
    if (c.tag === 'input' || (c.tag === 'button' && c.type !== 'submit')) s += ` type="${c.type}"`;
    if (c.role) s += ` role="${c.role}"`;
    if (c.id) s += ` id="${c.id}"`;
    else if (c.inputName) s += ` name="${c.inputName}"`;
    return s + '>';
  }

  // Returns { name, source, issues } for one control.
  function accName(c) {
    const issues = [];
    const add = (level, code, msg, fix) => issues.push({ level, code, msg, fix });
    if (c.labelledby) {
      const lb = c.labelledby;
      const missing = lb.filter(t => !t.found).map(t => t.id);
      const text = clean(lb.filter(t => t.found).map(t => t.text).join(' '));
      if (missing.length) {
        add(text ? 'warn' : 'error', 'labelledby-missing',
          `aria-labelledby points at ${missing.map(m => `id "${m}"`).join(', ')}, which ${missing.length > 1 ? "don't" : "doesn't"} exist on the page${text ? '' : ', so the name it was meant to give is lost'}.`,
          `Give the label element id="${missing[0]}", or change aria-labelledby to the id it really has.`);
      } else if (lb.length === 0) {
        add('warn', 'labelledby-missing', 'aria-labelledby is present but empty.', 'Remove the empty attribute or list the id of the element holding the label.');
      }
      const empty = lb.filter(t => t.found && !t.text).map(t => t.id);
      if (empty.length) add('warn', 'labelledby-empty', `aria-labelledby points at ${empty.map(m => `id "${m}"`).join(', ')}, which has no text.`, 'Point aria-labelledby at an element that contains the visible label text.');
      const dups = lb.filter(t => t.dup).map(t => t.id);
      if (dups.length) add('warn', 'dup-id', `id "${dups[0]}" is used by more than one element, so aria-labelledby uses only the first one.`, 'Make every id on the page unique.');
      if (text) return { name: text, source: 'aria-labelledby', issues };
    }
    if (c.ariaLabel) return { name: c.ariaLabel, source: 'aria-label', issues };
    if (c.kind === 'field') {
      const t = clean((c.labels || []).join(' '));
      if (t) return { name: t, source: 'label', issues };
    } else {
      if (c.tag === 'input' && c.type === 'image') { if (c.alt) return { name: c.alt, source: 'alt', issues }; }
      else if (c.tag === 'input') {
        if (c.value) return { name: c.value, source: 'value', issues };
        if (DEFAULT_BUTTON[c.type]) return { name: DEFAULT_BUTTON[c.type], source: 'browser default', issues };
      } else if (c.content) return { name: c.content, source: 'content', issues };
    }
    if (c.title) return { name: c.title, source: 'title', issues };
    if (c.kind === 'field' && c.placeholder) return { name: c.placeholder, source: 'placeholder', issues };
    return { name: '', source: null, issues };
  }

  function analyzeControl(c) {
    const { name, source, issues } = accName(c);
    const add = (level, code, msg, fix) => issues.push({ level, code, msg, fix });
    const desc = describe(c);
    if (!name) {
      if (c.kind === 'field') {
        const emptyLabel = (c.labels || []).length > 0;
        add('error', 'no-name', `This ${c.type === 'checkbox' || c.type === 'radio' ? c.type : 'field'} has no accessible name${emptyLabel ? ' (its <label> is empty)' : ''}, so a screen reader announces it without saying what to enter.`,
          `Add a visible <label for="${c.id || 'field-id'}"> with text${c.id ? '' : ' (give the field an id)'}, or wrap the field in a <label>. Use aria-label only when a visible label really can't be shown.`);
      } else if (c.tag === 'input' && c.type === 'image') {
        add('error', 'no-name', 'This image button has no alt text, so a screen reader reads out the file name or just "button".', 'Add alt text that names the action, for example alt="Search".');
      } else {
        add('error', 'no-name', 'This button has no accessible name, so a screen reader announces just "button".', 'Add visible text, or an aria-label naming the action if it is an icon-only button (for example aria-label="Close").');
      }
    } else if (source === 'placeholder') {
      add('warn', 'placeholder-only', `Its only name is the placeholder ${q(name)}, which disappears as soon as someone starts typing.`, `Add a visible <label> with that text (for example <label for="${c.id || 'field-id'}">${clean(name)}</label>).`);
    } else if (source === 'title') {
      add('warn', 'title-only', `Its only name is the title tooltip ${q(name)}, which most people never see and touch users can't open.`, 'Add a visible label or visible button text.');
    }
    if (name && (source === 'aria-label' || source === 'aria-labelledby')) {
      const visible = c.kind === 'field' ? clean((c.labels || []).join(' ')) : clean(c.content || c.value || '');
      if (visible && norm(visible) && !norm(name).includes(norm(visible))) {
        add('warn', 'label-in-name', `Its accessible name ${q(name)} doesn't contain its visible label ${q(visible)} (WCAG 2.5.3 Label in Name), so speech-input users can't activate it by saying what they see.`,
          `Start the ${source} with the visible text, or remove it so the visible label is used.`);
      }
    }
    if (c.ariaHidden && c.focusable) {
      add('error', 'hidden-focusable', 'It can still be reached with the Tab key but sits inside aria-hidden="true", so screen readers land on it and announce nothing.',
        'Remove aria-hidden from the container, or take the control out of the tab order (disabled or tabindex="-1") while it is hidden.');
    }
    return { kind: c.kind, tag: c.tag, path: c.path, desc, name, source, issues };
  }

  function analyze(raw) {
    raw = raw || {};
    const controls = raw.controls || [];
    const items = controls.map(analyzeControl);
    const controlPaths = new Set(controls.filter(c => c.labelledby).map(c => c.path));
    let refsChecked = 0, broken = 0;
    for (const c of controls) for (const t of c.labelledby || []) { refsChecked++; if (!t.found) broken++; }
    for (const r of raw.refs || []) {
      if (r.attr === 'aria-labelledby' && controlPaths.has(r.path)) continue;
      const issues = [];
      const missing = r.targets.filter(t => !t.found).map(t => t.id);
      refsChecked += r.targets.length; broken += missing.length;
      if (missing.length) issues.push({ level: 'error', code: 'broken-ref', msg: `${r.attr} on <${r.tag}> points at ${missing.map(m => `id "${m}"`).join(', ')}, which ${missing.length > 1 ? "don't" : "doesn't"} exist on the page.`, fix: `Give the intended element id="${missing[0]}", or correct the ${r.attr} value.` });
      const dups = r.targets.filter(t => t.dup).map(t => t.id);
      if (dups.length) issues.push({ level: 'warn', code: 'dup-id', msg: `id "${dups[0]}" is used by more than one element, so ${r.attr} may point at the wrong one.`, fix: 'Make every id on the page unique.' });
      if (!r.targets.length) issues.push({ level: 'warn', code: 'broken-ref', msg: `${r.attr} on <${r.tag}> is present but empty.`, fix: 'Remove the empty attribute or list a real id.' });
      items.push({ kind: 'reference', tag: r.tag, path: r.path, desc: `${r.attr}="${r.targets.map(t => t.id).join(' ')}" on <${r.tag}>`, name: null, source: null, issues });
    }
    for (const l of raw.labelFors || []) {
      const issues = [];
      if (!l.found) issues.push({ level: 'warn', code: 'orphan-label', msg: `<label for="${l.for}"> ${q(l.text)} points at no element with that id, so it labels nothing.`, fix: `Set for= to the field's real id, or give the field id="${l.for}".` });
      else if (!l.labelable) issues.push({ level: 'warn', code: 'orphan-label', msg: `<label for="${l.for}"> points at an element that can't be labelled this way.`, fix: 'Point it at an input, select, textarea or button, or use aria-labelledby on custom controls.' });
      if (issues.length) items.push({ kind: 'label', tag: 'label', path: l.path, desc: `<label for="${l.for}">`, name: null, source: null, issues });
    }
    items.forEach((it, i) => {
      it.i = i;
      it.status = it.issues.some(x => x.level === 'error') ? 'error' : it.issues.some(x => x.level === 'warn') ? 'warn' : 'ok';
    });
    const cs = items.filter(it => it.kind === 'field' || it.kind === 'button');
    const summary = {
      controls: cs.length, fields: cs.filter(x => x.kind === 'field').length, buttons: cs.filter(x => x.kind === 'button').length,
      unnamed: cs.filter(x => !x.name).length,
      errors: items.filter(x => x.status === 'error').length, warnings: items.filter(x => x.status === 'warn').length,
      ok: items.filter(x => x.status === 'ok').length, refsChecked, brokenRefs: broken, truncated: !!raw.truncated,
    };
    return { url: raw.url || '', items, summary };
  }

  function filter(report, kind) {
    const pick = { errors: x => x.status === 'error', warnings: x => x.status === 'warn', all: () => true }[kind] || (() => true);
    return report.items.filter(pick).sort((a, b) => RANK[a.status] - RANK[b.status] || a.i - b.i);
  }

  function toText(report) {
    const s = report.summary;
    const out = ['Form Label & ARIA Auditor report', `Page: ${report.url}`,
      `Controls: ${s.controls} (${s.fields} fields, ${s.buttons} buttons) | errors: ${s.errors} | warnings: ${s.warnings} | ok: ${s.ok}`,
      `ARIA ID references checked: ${s.refsChecked}, broken: ${s.brokenRefs}`, ''];
    filter(report, 'all').forEach((it, n) => {
      const nm = it.kind === 'field' || it.kind === 'button' ? ` | name: ${it.name ? `${q(it.name)} (from ${it.source})` : 'none'}` : '';
      out.push(`#${n + 1} ${it.desc} | ${it.status.toUpperCase()}${nm}`);
      for (const x of it.issues) out.push(`- [${x.level === 'error' ? 'ERROR' : 'WARN'}] ${x.msg}`, `  Fix: ${x.fix}`);
    });
    out.push('', 'Not checked: fields and buttons added after the scan, content inside iframes and shadow DOM, links, and whether a label actually describes its field. Names follow a simplified version of the browser name calculation.');
    if (s.truncated) out.push('Only the first 1000 controls were checked.');
    return out.join('\n');
  }

  return { analyze, analyzeControl, accName, describe, filter, toText };
});
