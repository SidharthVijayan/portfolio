// Image Alt Text Auditor core: pure functions, no DOM, no network. Shared by the popup and Node tests.
// Rules follow the HTML spec's guidance on alt text, WCAG 2.2 SC 1.1.1 (Non-text Content) and 2.4.4 (Link Purpose),
// and WAI-ARIA's presentation/none and aria-hidden semantics.
// This is a helper, not a full accessibility audit: it cannot judge whether a description is accurate.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LONG_ALT = 150;
  const FILE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic|ico)(\?.*)?$/i;
  const CAMERA_NAME = /^(img|image|dsc|dscn|dscf|dcim|pxl|photo|pic|screenshot|screen shot|scan|untitled|wp|shot|mvimg)[\s_-]*\d{2,}/i;
  const HASH_LIKE = /^([a-f0-9]{16,}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
  const GENERIC = new Set(['image', 'img', 'images', 'picture', 'pic', 'photo', 'photograph', 'graphic', 'icon', 'logo',
    'spacer', 'placeholder', 'alt', 'alt text', 'alttext', 'null', 'undefined', 'none', 'untitled', 'blank', 'banner',
    'thumbnail', 'thumb', 'default', 'image description', 'insert alt text', 'alt text here', 'todo', 'tbd', 'test']);
  const PREFIX = /^(an? )?(image|picture|photo|photograph|graphic) of\b/i;

  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const shorten = (s, n) => { s = clean(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

  // Last path segment of an image URL, e.g. "https://x/a/IMG_1.jpg?w=2" -> "IMG_1.jpg". data: URLs -> "(inline data image)".
  function fileName(src) {
    const s = clean(src);
    if (!s) return '';
    if (/^data:/i.test(s)) return '(inline data image)';
    const p = s.split(/[?#]/)[0].replace(/\/+$/, '');
    let f = p.slice(p.lastIndexOf('/') + 1);
    try { f = decodeURIComponent(f); } catch { /* keep raw */ }
    return f || s;
  }

  // True when alt text looks like a file name or camera/CMS identifier rather than a description.
  function isFilenameLike(alt, src) {
    const a = clean(alt);
    if (!a) return false;
    if (FILE_EXT.test(a) || CAMERA_NAME.test(a) || HASH_LIKE.test(a)) return true;
    const base = fileName(src).replace(FILE_EXT, '');
    if (base && base.length > 2 && a.toLowerCase() === base.toLowerCase() && /[_\-.\d]/.test(base)) return true;
    if (!/\s/.test(a) && a.length > 3 && (/_/.test(a) || (/\d{3,}/.test(a) && /[a-z]/i.test(a)))) return true;
    return false;
  }

  function isGeneric(alt) {
    const raw = clean(alt).toLowerCase();
    if (raw && /^[\W_]+$/.test(raw)) return true;
    return GENERIC.has(raw.replace(/[.:!]+$/, ''));
  }

  const issue = (code, level, msg, fix) => ({ code, level, msg, fix });

  // raw: { url, images: [{ i, tag, src, srcAttr, dataSrc, hasAlt, alt, role, ariaHidden, ariaLabel, ariaLabelledby,
  //                         title, width, height, naturalWidth, naturalHeight, visible, link: {kind, text, otherImageAlt} | null }] }
  function analyze(raw) {
    const images = (raw.images || []).map((im, n) => {
      const src = clean(im.src) || clean(im.srcAttr) || clean(im.dataSrc);
      const alt = im.alt == null ? null : String(im.alt);
      const hasAlt = im.hasAlt !== undefined ? !!im.hasAlt : alt != null;
      const role = clean(im.role).toLowerCase().split(' ')[0];
      const hiddenBy = im.ariaHidden ? 'aria-hidden="true"' : (role === 'presentation' || role === 'none') ? `role="${role}"` : '';
      return {
        i: im.i == null ? n : im.i, tag: im.tag === 'input' ? 'input' : 'img', src, file: fileName(src),
        lazy: !clean(im.src) && !clean(im.srcAttr) && !!clean(im.dataSrc),
        hasAlt, alt: hasAlt ? (alt == null ? '' : alt) : null, hiddenBy,
        ariaName: clean(im.ariaLabel) || clean(im.ariaLabelledby), title: clean(im.title),
        width: im.width || 0, height: im.height || 0, visible: im.visible !== false, link: im.link || null,
        issues: [], status: 'ok',
      };
    });

    for (const im of images) {
      const a = im.alt == null ? '' : clean(im.alt);
      const what = im.tag === 'input' ? 'image button' : 'image';
      const inLink = im.link && !clean(im.link.text) && !im.link.otherImageAlt;
      if (im.hiddenBy) {
        im.status = 'decorative';
        if (!im.hasAlt) im.issues.push(issue('decorative-no-alt', 'warn', `Hidden from screen readers by ${im.hiddenBy}, but has no alt attribute.`, 'Add alt="" so every browser and tool treats it as decorative.'));
        else if (a) im.issues.push(issue('decorative-with-alt', 'info', `Has alt text ("${shorten(a, 40)}") but ${im.hiddenBy} hides it, so screen readers never announce it.`, 'If the image is informative, remove the hiding; if it is decorative, use alt="".'));
        if (inLink) im.issues.push(issue('link-no-name', 'error', `This image is the only content of a ${im.link.kind} and is hidden, so the ${im.link.kind} has no accessible name.`, `Give the ${im.link.kind} a name: visible text, an aria-label, or alt text describing where it goes.`));
        continue;
      }
      if (!im.hasAlt) {
        im.status = 'missing';
        if (im.ariaName) im.issues.push(issue('alt-missing-aria', 'warn', `No alt attribute. It is named by aria-label/aria-labelledby ("${shorten(im.ariaName, 40)}"), but HTML still requires alt.`, `Add alt="${shorten(im.ariaName, 60)}".`));
        else im.issues.push(issue('alt-missing', 'error', `No alt attribute. Screen readers may read out the file name${im.file ? ` ("${shorten(im.file, 40)}")` : ''} instead.${im.title ? ' A title attribute is not a reliable substitute.' : ''}`, `Add alt text that says what the ${what} shows or does, or alt="" if it is purely decorative.`));
        if (im.tag === 'input' && !im.ariaName) im.issues.push(issue('control-no-name', 'error', 'This image button has no alt text, so the button has no accessible name.', 'Add alt text naming the action, e.g. alt="Search".'));
        else if (inLink && !im.ariaName) im.issues.push(issue('link-no-name', 'error', `This image is the only content of a ${im.link.kind}, so the ${im.link.kind} has no accessible name.`, `Add alt text describing where the ${im.link.kind} goes or what it does.`));
        continue;
      }
      if (!a) {
        im.status = 'empty';
        if (im.alt !== '') im.issues.push(issue('alt-whitespace', 'warn', 'The alt attribute contains only spaces.', 'Use alt="" (nothing between the quotes) for a decorative image, or describe the image.'));
        if (im.tag === 'input') im.issues.push(issue('control-no-name', 'error', 'This image button has empty alt text, so the button has no accessible name.', 'Add alt text naming the action, e.g. alt="Search".'));
        else if (inLink) im.issues.push(issue('link-no-name', 'error', `This image is the only content of a ${im.link.kind}, and its empty alt leaves the ${im.link.kind} with no accessible name.`, `Add alt text describing where the ${im.link.kind} goes or what it does.`));
        else im.issues.push(issue('alt-empty', 'info', 'Empty alt (alt=""): screen readers skip this image. That is correct for decorative images.', 'Check it really adds no information; if it does, describe it.'));
        continue;
      }
      if (isFilenameLike(a, im.src)) { im.status = 'filename'; im.issues.push(issue('alt-filename', 'warn', `The alt text "${shorten(a, 50)}" looks like a file name, not a description.`, `Describe what the ${what} shows or does.`)); }
      else if (isGeneric(a)) { im.status = 'generic'; im.issues.push(issue('alt-generic', 'warn', `The alt text "${shorten(a, 30)}" is a placeholder word and does not describe the image.`, `Describe what the ${what} shows or does, or use alt="" if it is decorative.`)); }
      if (PREFIX.test(a)) im.issues.push(issue('alt-redundant-prefix', 'info', 'The alt text starts with "image of" or similar; screen readers already announce it as an image.', 'Drop the prefix and start with the subject.'));
      if (a.length > LONG_ALT) im.issues.push(issue('alt-long', 'info', `The alt text is ${a.length} characters long.`, `Keep alt text short (under about ${LONG_ALT} characters) and put longer descriptions in visible text or a caption.`));
    }

    // Duplicates: the same non-empty alt on images with different sources (decorative images excluded).
    const groups = new Map();
    for (const im of images) {
      const a = im.alt == null ? '' : clean(im.alt).toLowerCase();
      if (!a || im.hiddenBy) continue;
      if (!groups.has(a)) groups.set(a, []);
      groups.get(a).push(im);
    }
    for (const list of groups.values()) {
      const srcs = new Set(list.map(im => im.src || `#${im.i}`));
      if (srcs.size < 2) continue;
      for (const im of list) {
        im.dup = list.length;
        if (im.status === 'ok') im.status = 'duplicate';
        im.issues.push(issue('alt-duplicate', 'warn', `The same alt text "${shorten(im.alt, 40)}" is used on ${list.length} images with different sources.`, 'Give each image alt text that describes that specific image.'));
      }
    }

    const all = images.flatMap(im => im.issues);
    const count = st => images.filter(im => im.status === st).length;
    const summary = {
      total: images.length,
      missing: count('missing'), empty: count('empty'), decorative: count('decorative'),
      filename: count('filename'), generic: count('generic'),
      duplicate: images.filter(im => im.issues.some(x => x.code === 'alt-duplicate')).length,
      ok: images.filter(im => !im.issues.some(x => x.level !== 'info')).length,
      needsAttention: images.filter(im => im.issues.some(x => x.level === 'error' || x.level === 'warn')).length,
      errors: all.filter(x => x.level === 'error').length,
      warnings: all.filter(x => x.level === 'warn').length,
      notes: all.filter(x => x.level === 'info').length,
      hidden: images.filter(im => !im.visible).length,
      lazy: images.filter(im => im.lazy).length,
    };
    return { url: raw.url || '', images, summary };
  }

  // Filters for the popup tabs.
  function filter(report, kind) {
    const imgs = report.images;
    if (kind === 'issues') return imgs.filter(im => im.issues.some(x => x.level === 'error' || x.level === 'warn'));
    if (kind === 'decorative') return imgs.filter(im => im.status === 'decorative' || im.status === 'empty');
    return imgs;
  }

  const altLabel = im => im.alt == null ? '(no alt attribute)' : clean(im.alt) ? `"${clean(im.alt)}"` : im.alt === '' ? '(empty: alt="")' : '(only spaces)';

  function toText(report) {
    const s = report.summary;
    const out = ['Image Alt Text Auditor report', `Page: ${report.url}`,
      `Images: ${s.total} | missing alt: ${s.missing} | empty alt: ${s.empty} | decorative (role/aria-hidden): ${s.decorative} | file-name alt: ${s.filename} | placeholder alt: ${s.generic} | duplicate alt: ${s.duplicate}`,
      `Errors: ${s.errors} | Warnings: ${s.warnings} | Notes: ${s.notes}`, ''];
    for (const im of report.images) {
      out.push(`#${im.i + 1} ${im.tag === 'input' ? '<input type=image> ' : ''}${im.file || '(no src)'}${im.visible ? '' : ' [not visible]'}${im.lazy ? ' [lazy, not loaded]' : ''}`);
      out.push(`  alt: ${altLabel(im)}${im.hiddenBy ? ` | hidden by ${im.hiddenBy}` : ''}`);
      if (im.src) out.push(`  src: ${im.src}`);
      for (const x of im.issues) out.push(`- [${x.level.toUpperCase()}] ${x.msg}`, `  Fix: ${x.fix}`);
    }
    out.push('', 'Not checked: CSS background images, inline <svg>, <canvas>, and images added after the scan.');
    return out.join('\n');
  }

  return { analyze, filter, toText, fileName, isFilenameLike, isGeneric, altLabel };
});
