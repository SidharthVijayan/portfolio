'use strict';
function analyzeDoc(doc, loc) {
  const rows = [];
  const h1 = doc.querySelectorAll('h1').length;
  const h2 = doc.querySelectorAll('h2').length;
  rows.push({ label: 'H1 count', value: h1, status: h1 === 1 ? 'good' : 'bad' });
  rows.push({ label: 'H2 count', value: h2, status: h2 > 0 ? 'good' : 'warn' });
  const meta = doc.querySelector("meta[name='description'], meta[name=\"description\"]");
  rows.push({ label: 'Meta description', value: meta ? 'Found' : 'Not found', status: meta ? 'good' : 'bad' });
  let longCount = 0;
  doc.querySelectorAll('p').forEach(p => {
    if ((p.innerText || '').split(/\s+/).filter(Boolean).length > 120) {
      longCount++;
      p.style.outline = '2px dashed orange';
    }
  });
  rows.push({ label: 'Long paragraphs', value: longCount, status: longCount === 0 ? 'good' : 'warn' });
  const lists = doc.querySelectorAll('ul, ol').length;
  rows.push({ label: 'Lists', value: lists, status: lists > 0 ? 'good' : 'bad' });
  const links = [...doc.querySelectorAll('a')];
  const host = (loc && loc.hostname) || '';
  const internal = links.filter(a => {
    try { return a.href && a.href.includes(host); } catch (e) { return false; }
  }).length;
  rows.push({ label: 'Internal links', value: internal, status: internal >= 3 ? 'good' : 'warn' });
  const text = (doc.body && doc.body.innerText || '').toLowerCase();
  const faq = text.includes('faq') || text.includes('frequently asked');
  rows.push({ label: 'FAQ section', value: faq ? 'Found' : 'Not found', status: faq ? 'good' : 'bad' });
  return rows;
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('analyzeBtn');
  const results = document.getElementById('results');
  async function run() {
    results.innerHTML = '<small>Analyzing page...</small>';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const [inj] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function () { return { href: location.href, host: location.hostname }; }
      });
      const loc = (inj && inj.result) || {};
      const [panel] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function () { return document.documentElement.outerHTML; }
      });
      // Analyse via a function run in the page, faithful to content.js checks
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function () {
          const rows = [];
          const h1 = document.querySelectorAll('h1').length;
          const h2 = document.querySelectorAll('h2').length;
          rows.push({ label: 'H1 count', value: String(h1), status: h1 === 1 ? 'good' : 'bad' });
          rows.push({ label: 'H2 count', value: String(h2), status: h2 > 0 ? 'good' : 'warn' });
          const meta = document.querySelector("meta[name='description']");
          rows.push({ label: 'Meta description', value: meta ? 'Found' : 'Not found', status: meta ? 'good' : 'bad' });
          let longCount = 0;
          document.querySelectorAll('p').forEach(p => {
            if (p.innerText.split(/\s+/).length > 120) {
              longCount++;
              p.style.outline = '2px dashed orange';
            }
          });
          rows.push({ label: 'Long paragraphs', value: String(longCount), status: longCount === 0 ? 'good' : 'warn' });
          const lists = document.querySelectorAll('ul, ol').length;
          rows.push({ label: 'Lists', value: String(lists), status: lists > 0 ? 'good' : 'bad' });
          const links = [...document.querySelectorAll('a')];
          const internal = links.filter(a => a.href.includes(location.hostname)).length;
          rows.push({ label: 'Internal links', value: String(internal), status: internal >= 3 ? 'good' : 'warn' });
          const text = document.body.innerText.toLowerCase();
          const faq = text.includes('faq') || text.includes('frequently asked');
          rows.push({ label: 'FAQ section', value: faq ? 'Found' : 'Not found', status: faq ? 'good' : 'bad' });
          return rows;
        }
      });
      const rows = (res && res.result) || [];
      results.innerHTML = '';
      rows.forEach(r => {
        const color = r.status === 'good' ? '#00e676' : r.status === 'warn' ? '#ffca28' : '#ff5252';
        const div = document.createElement('div');
        div.className = 'row';
        div.style.color = color;
        div.textContent = r.label + ': ' + r.value;
        results.appendChild(div);
      });
      if (!rows.length) results.textContent = 'No results.';
    } catch (error) {
      console.error(error);
      results.innerHTML = "<span style='color:red;'>Error running analysis</span>";
    }
  }
  btn.addEventListener('click', run);
});
