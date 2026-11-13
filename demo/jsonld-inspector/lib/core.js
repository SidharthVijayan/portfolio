// JSON-LD Structured Data Inspector: pure analysis logic.
// No chrome.* and no DOM: loaded by the popup via <script> and by Node tests via require().
//
// Rules follow Google Search Central structured-data guidance for common rich-result types
// (required vs recommended properties). This is a helper, not an official validator.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- type rules -------------------------------------------------------
  // required: each entry is a property name, or an array meaning "at least one of".
  const ARTICLE = { required: [], recommended: ['headline', 'image', 'datePublished', 'dateModified', 'author'] };
  const RULES = {
    Article: ARTICLE, NewsArticle: ARTICLE, BlogPosting: ARTICLE,
    Product: { required: ['name', ['offers', 'review', 'aggregateRating']], recommended: ['image', 'description', 'sku', 'brand'] },
    Offer: { required: [['price', 'priceSpecification']], recommended: ['priceCurrency', 'availability', 'url'] },
    AggregateRating: { required: ['ratingValue', ['ratingCount', 'reviewCount']], recommended: ['bestRating'] },
    Review: { required: ['author', 'reviewRating'], recommended: ['datePublished'] },
    FAQPage: { required: ['mainEntity'], recommended: [] },
    Question: { required: ['name', 'acceptedAnswer'], recommended: [] },
    Answer: { required: ['text'], recommended: [] },
    BreadcrumbList: { required: ['itemListElement'], recommended: [] },
    ListItem: { required: ['position'], recommended: ['name', 'item'] },
    Organization: { required: [], recommended: ['name', 'url', 'logo'] },
    LocalBusiness: { required: ['name', 'address'], recommended: ['telephone', 'url', 'geo', 'openingHoursSpecification'] },
    Event: { required: ['name', 'startDate', 'location'], recommended: ['endDate', 'eventStatus', 'image', 'description', 'offers', 'organizer'] },
    Recipe: { required: ['name', 'image'], recommended: ['author', 'datePublished', 'description', 'recipeIngredient', 'recipeInstructions', 'totalTime'] },
    VideoObject: { required: ['name', 'thumbnailUrl', 'uploadDate'], recommended: ['description', 'duration', ['contentUrl', 'embedUrl']] },
    WebSite: { required: [], recommended: ['name', 'url'] },
    Person: { required: ['name'], recommended: [] },
  };
  // Types that are full rich-result subjects on their own. When they appear nested as a mere
  // pointer (e.g. itemReviewed, author's employer, isPartOf) their rich-result rules are not applied.
  const SUBJECT_TYPES = new Set(['Article', 'NewsArticle', 'BlogPosting', 'Product', 'Organization', 'LocalBusiness', 'Event', 'Recipe', 'WebSite', 'FAQPage']);
  const SUBJECT_PARENTS = new Set(['hasVariant', 'mainEntity', '@graph']); // nested subjects that ARE checked
  const REF_KEYS = new Set(['@type', '@id', 'url', 'sameAs', '@context']);
  const DATE_PROPS = ['datePublished', 'dateModified', 'dateCreated', 'startDate', 'endDate', 'uploadDate', 'validFrom', 'priceValidUntil'];
  const URL_PROPS = ['url', 'image', 'item', 'logo', 'thumbnailUrl', 'contentUrl', 'embedUrl', 'sameAs'];
  const DURATION_PROPS = ['duration', 'totalTime', 'cookTime', 'prepTime'];
  // ISO 8601 date or date-time (YYYY-MM-DD with optional Thh:mm[:ss[.sss]][Z|±hh:mm])
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

  // ---- helpers -----------------------------------------------------------
  function normType(t) {
    return String(t).replace(/^https?:\/\/schema\.org\//i, '').replace(/^schema:/i, '');
  }
  function typesOf(node) {
    const t = node['@type'];
    if (t == null) return [];
    return (Array.isArray(t) ? t : [t]).map(normType);
  }
  function isEmpty(v) {
    return v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
  }
  function has(node, prop) { return Object.prototype.hasOwnProperty.call(node, prop) && !isEmpty(node[prop]); }
  function isAbsoluteUrl(s) { return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s); }
  function isSchemaContext(ctx) {
    if (ctx == null) return false;
    if (typeof ctx === 'string') return /^https?:\/\/schema\.org\/?$/i.test(ctx.trim());
    if (Array.isArray(ctx)) return ctx.some(isSchemaContext);
    if (typeof ctx === 'object') return isSchemaContext(ctx['@vocab']) || Object.values(ctx).some(v => typeof v === 'string' && /schema\.org/i.test(v));
    return false;
  }

  /** Parse one <script type="application/ld+json"> body. Returns {ok, value} or {ok:false, error}. */
  function parseBlock(text) {
    const cleaned = String(text || '').trim().replace(/^<!--/, '').replace(/-->$/, '').replace(/^\/\/<!\[CDATA\[|\/\/\]\]>$/g, '').trim();
    if (!cleaned) return { ok: false, error: 'Empty JSON-LD block' };
    try { return { ok: true, value: JSON.parse(cleaned) }; }
    catch (e) { return { ok: false, error: `Invalid JSON: ${e.message}` }; }
  }

  /** Walk a parsed value and collect every node that has an @type, with a readable path. */
  function collectEntities(value, blockIndex) {
    const out = [];
    function walk(v, pathStr, depth, inheritedCtx) {
      if (depth > 40 || v == null || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${pathStr}[${i}]`, depth + 1, inheritedCtx)); return; }
      const ctx = v['@context'] !== undefined ? v['@context'] : inheritedCtx;
      const types = typesOf(v);
      const parentProp = (pathStr.match(/\.([^.[\]]+)(\[\d+\])?$/) || [])[1] || null;
      if (types.length) out.push({ node: v, types, path: pathStr, block: blockIndex, nested: depth > 0 && !/^\$(\[\d+\])?(\.@graph\[\d+\])?$/.test(pathStr), parentProp, context: ctx });
      for (const [k, child] of Object.entries(v)) {
        if (k === '@context') continue;
        walk(child, `${pathStr}.${k}`, depth + 1, ctx);
      }
    }
    walk(value, '$', 0, undefined);
    return out;
  }

  /** Check one entity against type rules and format rules. */
  function checkEntity(ent) {
    const issues = [];
    const n = ent.node;
    if (!ent.nested && !isSchemaContext(ent.context)) {
      issues.push({ level: 'error', prop: '@context', msg: 'Missing or non-schema.org @context', fix: 'Add "@context": "https://schema.org" to the top-level object.' });
    }
    const isReference = isRef(ent);
    for (const type of ent.types) {
      const rule = RULES[type];
      if (!rule || isReference) continue; // a bare {"@type","@id"/"url"} pointer: details live elsewhere
      if (ent.nested && SUBJECT_TYPES.has(type) && !SUBJECT_PARENTS.has(ent.parentProp)) continue;
      for (const req of rule.required) {
        const alts = Array.isArray(req) ? req : [req];
        if (!alts.some(p => has(n, p))) {
          issues.push({ level: 'error', prop: alts.join(' | '), msg: `${type}: missing required ${alts.length > 1 ? 'one of ' + alts.join(', ') : alts[0]}`, fix: `Add ${alts.length > 1 ? 'at least one of ' + alts.map(a => `"${a}"`).join(', ') : `"${alts[0]}"`} to this ${type}.` });
        }
      }
      for (const rec of rule.recommended) {
        const alts = Array.isArray(rec) ? rec : [rec];
        if (!alts.some(p => has(n, p) || (p === 'name' && n.item && typeof n.item === 'object' && has(n.item, 'name')))) {
          issues.push({ level: 'warning', prop: alts.join(' | '), msg: `${type}: recommended ${alts.join(' or ')} is missing`, fix: `Consider adding "${alts[0]}" for richer results.` });
        }
      }
      if (type === 'FAQPage' && has(n, 'mainEntity')) {
        const qs = Array.isArray(n.mainEntity) ? n.mainEntity : [n.mainEntity];
        if (!qs.some(q => q && typesOf(q).includes('Question'))) issues.push({ level: 'error', prop: 'mainEntity', msg: 'FAQPage: mainEntity contains no Question items', fix: 'Each mainEntity item should be {"@type":"Question","name":…,"acceptedAnswer":{"@type":"Answer","text":…}}.' });
      }
      if (type === 'BreadcrumbList' && Array.isArray(n.itemListElement)) {
        const pos = n.itemListElement.map(li => li && Number(li.position));
        const sequential = pos.every((p, i) => p === i + 1);
        if (!sequential) issues.push({ level: 'warning', prop: 'itemListElement.position', msg: 'BreadcrumbList: positions are not 1, 2, 3… in order', fix: 'Number ListItem positions sequentially starting at 1.' });
      }
    }
    for (const p of DATE_PROPS) {
      if (typeof n[p] === 'string' && !ISO_DATE.test(n[p].trim())) issues.push({ level: 'error', prop: p, msg: `${p} "${n[p]}" is not an ISO 8601 date`, fix: 'Use e.g. "2026-10-19" or "2026-10-19T09:30:00+05:30".' });
    }
    for (const p of DURATION_PROPS) {
      if (typeof n[p] === 'string' && !ISO_DURATION.test(n[p].trim())) issues.push({ level: 'error', prop: p, msg: `${p} "${n[p]}" is not an ISO 8601 duration`, fix: 'Use e.g. "PT1H30M" or "PT45S".' });
    }
    for (const p of URL_PROPS) {
      const vals = Array.isArray(n[p]) ? n[p] : [n[p]];
      for (const v of vals) if (typeof v === 'string' && v.trim() && !isAbsoluteUrl(v.trim())) issues.push({ level: 'warning', prop: p, msg: `${p} "${v}" is not an absolute URL`, fix: 'Use a full URL starting with https://.' });
    }
    for (const [k, v] of Object.entries(n)) {
      const ent = typeof v === 'string' && !URL_PROPS.includes(k) && v.match(/&(#\d{2,6}|#x[0-9a-f]{2,6}|amp|quot|apos|lt|gt|nbsp|rsquo|lsquo|rdquo|ldquo|mdash|ndash|hellip);/i);
      if (ent) issues.push({ level: 'warning', prop: k, msg: `${k} contains an HTML entity (${ent[0]})`, fix: 'JSON-LD text is not HTML-decoded; output the plain character instead (e.g. \u2019 rather than &#8217;).' });
      if (!k.startsWith('@') && typeof v === 'string' && v.trim() === '') issues.push({ level: 'warning', prop: k, msg: `${k} is an empty string`, fix: `Remove "${k}" or give it a value.` });
    }
    return issues;
  }

  /** A nested node that only points elsewhere: {"@type", "@id" and/or "url" [, "sameAs"]}. */
  function isRef(ent) {
    const n = ent.node;
    return ent.nested && (has(n, '@id') || has(n, 'url')) && Object.keys(n).every(k => REF_KEYS.has(k));
  }

  function label(node) {
    for (const k of ['name', 'headline', 'title']) if (typeof node[k] === 'string' && node[k].trim()) return node[k].trim().slice(0, 80);
    return '';
  }

  /**
   * Main entry.
   * @param {{url?:string, jsonld:string[], microdata?:number, rdfa?:number}} data  as returned by content/extract.js
   */
  function analyze(data) {
    const blocks = Array.isArray(data && data.jsonld) ? data.jsonld : [];
    const parseErrors = [];
    const entities = [];
    blocks.forEach((text, i) => {
      const r = parseBlock(text);
      if (!r.ok) { parseErrors.push({ block: i + 1, error: r.error }); return; }
      for (const ent of collectEntities(r.value, i + 1)) {
        const reference = isRef(ent);
        entities.push({ types: ent.types, label: label(ent.node) || (reference ? String(ent.node.url || ent.node['@id'] || '').slice(0, 80) : ''), block: ent.block, path: ent.path, nested: ent.nested, reference, issues: checkEntity(ent) });
      }
    });
    const typeCounts = {};
    entities.forEach(e => e.types.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; }));
    const errors = parseErrors.length + entities.reduce((a, e) => a + e.issues.filter(i => i.level === 'error').length, 0);
    const warnings = entities.reduce((a, e) => a + e.issues.filter(i => i.level === 'warning').length, 0);
    return {
      url: (data && data.url) || '',
      summary: { blocks: blocks.length, entities: entities.length, errors, warnings, typeCounts, microdataItems: (data && data.microdata) || 0, rdfaItems: (data && data.rdfa) || 0 },
      parseErrors,
      entities,
    };
  }

  /** Plain-text report for the "Copy report" button. */
  function toText(report) {
    const s = report.summary;
    const lines = [`JSON-LD report for ${report.url || '(unknown page)'}`,
      `Blocks: ${s.blocks} | Entities: ${s.entities} | Errors: ${s.errors} | Warnings: ${s.warnings}`];
    if (s.microdataItems || s.rdfaItems) lines.push(`Also on page (not checked): ${s.microdataItems} Microdata item(s), ${s.rdfaItems} RDFa item(s)`);
    report.parseErrors.forEach(p => lines.push(`[ERROR] Block ${p.block}: ${p.error}`));
    report.entities.forEach(e => {
      lines.push('', `${e.types.join(', ')}${e.label ? ' - ' + e.label : ''}  (block ${e.block}, ${e.path})`);
      if (!e.issues.length) lines.push('  OK: no issues');
      e.issues.forEach(i => lines.push(`  [${i.level.toUpperCase()}] ${i.msg} -> ${i.fix}`));
    });
    return lines.join('\n');
  }

  return { analyze, toText, parseBlock, collectEntities, checkEntity, RULES, _internal: { ISO_DATE, ISO_DURATION, isSchemaContext, normType } };
});
