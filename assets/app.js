// QuietMark editor
(() => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // Elements
  const editor = $('#editor');
  const srcTA = $('#source');
  const fileInput = $('#fileInput');
  const dropZone = $('#dropZone');
  const btnLoad = $('#btnLoad');
  const btnExport = $('#btnExport');
  const btnSource = $('#btnSource');
  const btnUndo = $('#btnUndo');
  const btnBold = $('#btnBold');
  const btnItalic = $('#btnItalic');
  const btnStrike = $('#btnStrike');
  const tableWrap = $('.table-wrap');
  const tablePicker = $('#tablePicker');
  const tableGrid = tablePicker.querySelector('.grid');
  const tableHint = $('#tableHint');
  const btnTable = $('#btnTable');
  const chartWrap = $('.chart-wrap');
  const btnChart = $('#btnChart');
  const chartBuilder = $('#chartBuilder');
  const chartSteps = chartBuilder.querySelector('.steps');
  const chartAddStep = chartBuilder.querySelector('.add-step');
  const chartInsert = chartBuilder.querySelector('.insert');
  const chartClose = chartBuilder.querySelector('.close');
  const toasts = $('#toasts');
  const root = document.documentElement;
  const shortcutsPanel = $('#shortcuts');
  const toggleShortcuts = $('#toggleShortcuts');

  function toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = msg;
    toasts.appendChild(el);
    setTimeout(() => { el.classList.add('fade'); el.addEventListener('transitionend', () => el.remove(), { once:true }); }, 2400);
  }

  let mode = 'wysiwyg'; // 'wysiwyg' | 'source'
  let currentFileName = 'untitled.md';
  let md, td;
  let undoStack = [];
  let lastSnapshot = '';

  try {
    if (!window.markdownit || !window.DOMPurify || !window.TurndownService || !window.turndownPluginGfm || !window.mermaid) {
      throw new Error('Missing required libraries');
    }
    md = window.markdownit({
      html: false,
      linkify: true,
      breaks: false
    }).enable(['table','strikethrough']);

    td = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '_'
    });
    turndownPluginGfm.gfm(td); // tables, strikethrough, task lists etc.

    td.addRule('sToStrike', {
      filter: ['s', 'strike'],
      replacement: (content) => '~~' + content + '~~'
    });

    td.addRule('mermaid', {
      filter: (node) => node.nodeName === 'DIV' && node.classList.contains('mermaid'),
      replacement: (_, node) => {
        const code = node.dataset.code || '';
        return '\n```mermaid\n' + code + '\n```\n';
      }
    });

    mermaid.initialize({ startOnLoad: false });
  } catch (err) {
    console.error(err);
    toast('Required libraries failed to load', 'warn');
    document.querySelectorAll('.btn').forEach(b => { b.disabled = true; b.setAttribute('aria-disabled','true'); });
    return;
  }

  function normaliseInlineTags(root=editor){
    // Replace b -> strong, i -> em, strike -> s, remove style spans
    root.querySelectorAll('b').forEach(n => replaceTag(n, 'strong'));
    root.querySelectorAll('i').forEach(n => replaceTag(n, 'em'));
    root.querySelectorAll('strike').forEach(n => replaceTag(n, 's'));
    root.querySelectorAll('span').forEach(n => {
      if (!n.attributes.length || n.getAttributeNames().every(a => a === 'data-id')) unwrap(n);
    });
  }

  function replaceTag(el, tag) {
    const n = document.createElement(tag);
    [...el.attributes].forEach(a => n.setAttribute(a.name, a.value));
    while (el.firstChild) n.appendChild(el.firstChild);
    el.replaceWith(n);
    return n;
  }
  function unwrap(el){ while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); }

  function getSelectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return sel.getRangeAt(0);
  }

  const BLOCKS = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','TD','TH']);

  function findBlockAncestor(node) {
    while (node && node !== editor) {
      if (node.nodeType === 1 && BLOCKS.has(node.nodeName)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function snapshot() {
    if (mode !== 'wysiwyg') return;
    const html = editor.innerHTML;
    if (html !== lastSnapshot) {
      undoStack.push(lastSnapshot);
      lastSnapshot = html;
    }
  }

  function undo() {
    if (mode !== 'wysiwyg') return;
    const prev = undoStack.pop();
    if (typeof prev === 'string') {
      editor.innerHTML = prev;
      normaliseInlineTags();
      editor.querySelectorAll('.mermaid').forEach(div => {
        div.removeAttribute('data-processed');
        if (window.mermaid) mermaid.init(undefined, div);
      });
      lastSnapshot = prev;
    }
  }

  function applyHeading(level) {
    if (mode !== 'wysiwyg') return;
    const rng = getSelectionRange();
    if (!rng) return;
    let node = findBlockAncestor(rng.startContainer);
    if (!node) {
      document.execCommand('formatBlock', false, 'p');
      node = findBlockAncestor(rng.startContainer);
      if (!node) return;
    }
    // do not convert list items or table cells into headings; instead, wrap inside as a heading-like style by toggling a <strong> on selection
    if (node.nodeName === 'LI' || node.nodeName === 'TD' || node.nodeName === 'TH') {
      document.execCommand('bold');
      normaliseInlineTags();
      return;
    }
    const tag = 'H' + level;
    const isSame = node.nodeName === tag;
    const target = isSame ? 'P' : tag;
    const id = node.id || '';
    const repl = replaceTag(node, target);
    if (id) repl.id = id;
    // move cursor to start of block
    const sel = window.getSelection();
    sel.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(repl);
    nr.collapse(true);
    sel.addRange(nr);
    snapshot();
  }

  function insertTable(rows, cols) {
    if (mode !== 'wysiwyg') return;
    const table = document.createElement('table');
    table.setAttribute('contenteditable', 'false'); // keep structure stable
    const tbody = document.createElement('tbody');
    for (let r=0; r<rows; r++){
      const tr = document.createElement('tr');
      for (let c=0; c<cols; c++){
        const tdCell = document.createElement('td');
        tdCell.setAttribute('contenteditable', 'true');
        tdCell.innerHTML = '<br>';
        tr.appendChild(tdCell);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    const rng = getSelectionRange();
    if (rng) {
      rng.deleteContents();
      rng.insertNode(table);
    } else {
      editor.appendChild(table);
    }
    // place caret into first cell
    const first = table.querySelector('td');
    if (first) {
      const sel = window.getSelection();
      const nr = document.createRange();
      nr.selectNodeContents(first);
      nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
    }
    snapshot();
  }

  function insertMermaidChart(def) {
    if (mode !== 'wysiwyg' || !def) return;
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.setAttribute('contenteditable', 'false');
    div.dataset.code = def;
    div.textContent = def;
    const rng = getSelectionRange();
    if (rng) {
      rng.deleteContents();
      rng.insertNode(div);
    } else {
      editor.appendChild(div);
    }
    div.removeAttribute('data-processed');
    if (window.mermaid) mermaid.init(undefined, div);
    snapshot();
  }

  function renderMarkdownToEditor(markdown, fromLoad=false) {
    try{
      const unsafe = md.render(markdown);
      const clean = DOMPurify.sanitize(unsafe, { USE_PROFILES: { html: true } });
      const tmp = document.createElement('div');
      tmp.innerHTML = clean;
      tmp.querySelectorAll('pre > code.language-mermaid').forEach(code => {
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.setAttribute('contenteditable','false');
        div.dataset.code = code.textContent;
        div.textContent = code.textContent;
        code.parentElement.replaceWith(div);
      });
      editor.innerHTML = tmp.innerHTML;
      normaliseInlineTags();
      undoStack = [];
      lastSnapshot = editor.innerHTML;
      if (fromLoad) editor.focus();
      editor.querySelectorAll('.mermaid').forEach(div => {
        div.removeAttribute('data-processed');
        if (window.mermaid) mermaid.init(undefined, div);
      });
    } catch(e){
      console.error(e);
      toast('Failed to parse file', 'warn');
    }
  }

  function exportMarkdown() {
    let mdOut = '';
    if (mode === 'source') {
      mdOut = srcTA.value || '';
    } else {
      normaliseInlineTags();
      const html = editor.innerHTML;
      mdOut = td.turndown(html);
    }
    if (!mdOut.trim()) { toast('Nothing to export', 'warn'); return; }
    let name = currentFileName || 'untitled.md';
    if (!/\.md$/i.test(name)) name += '.md';
    const blob = new Blob([mdOut], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast('Exported ' + name, 'success');
  }

  function toggleTheme(){
    const current = root.getAttribute('data-theme');
    root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
  }

  // File loading
  btnLoad.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!/^(text\/markdown|text\/plain)$/i.test(f.type || 'text/markdown') && !/\.md$/i.test(f.name)) {
      toast('Unsupported mime type', 'warn'); return;
    }
    try {
      const txt = await f.text();
      currentFileName = f.name;
      renderMarkdownToEditor(txt, true);
      toast('Loaded ' + f.name, 'success');
      if (mode === 'source') toggleSource(false);
    } catch(err) {
      console.error(err);
      toast('Failed to parse file', 'warn');
    } finally {
      fileInput.value = '';
    }
  });

  // Drag and drop
  ['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover');
  }));
  ['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', async (e) => {
    const dt = e.dataTransfer;
    if (!dt || !dt.files || !dt.files[0]) return;
    const f = dt.files[0];
    if (!/^(text\/markdown|text\/plain)$/i.test(f.type || 'text/markdown') && !/\.md$/i.test(f.name)) {
      toast('Unsupported mime type', 'warn'); return;
    }
    try{
      const txt = await f.text();
      currentFileName = f.name;
      renderMarkdownToEditor(txt, true);
      toast('Loaded ' + f.name, 'success');
      if (mode === 'source') toggleSource(false);
    }catch(err){
      console.error(err);
      toast('Failed to parse file', 'warn');
    }
  });

  // Paste: keep it clean
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  editor.addEventListener('dblclick', (e) => {
    const mer = e.target.closest('.mermaid');
    if (!mer || mode !== 'wysiwyg') return;
    const updated = prompt('Mermaid definition', mer.dataset.code || '');
    if (!updated) return;
    mer.dataset.code = updated;
    mer.innerHTML = updated;
    mer.removeAttribute('data-processed');
    if (window.mermaid) mermaid.init(undefined, mer);
    snapshot();
  });

  // Advanced toggle
  function toggleSource(forceToSource) {
    const toSource = typeof forceToSource === 'boolean' ? forceToSource : (mode === 'wysiwyg');
    if (toSource) {
      // html -> md -> textarea
      normaliseInlineTags();
      const html = editor.innerHTML;
      const mdOut = td.turndown(html);
      srcTA.value = mdOut;
      editor.style.display = 'none';
      srcTA.style.display = 'block';
      srcTA.focus();
      btnSource.setAttribute('aria-pressed', 'true');
      mode = 'source';
    } else {
      // textarea -> html
      const mdIn = srcTA.value || '';
      renderMarkdownToEditor(mdIn);
      srcTA.style.display = 'none';
      editor.style.display = 'block';
      editor.focus();
      btnSource.setAttribute('aria-pressed', 'false');
      mode = 'wysiwyg';
    }
  }

  // Table picker build
  const GRID_SIZE = 10;
  function buildTableGrid(){
    tableGrid.innerHTML = '';
    for (let r=1; r<=GRID_SIZE; r++){
      for (let c=1; c<=GRID_SIZE; c++){
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.r = r;
        b.dataset.c = c;
        tableGrid.appendChild(b);
      }
    }
  }
  buildTableGrid();

  function openPicker() {
    tablePicker.classList.add('open');
    btnTable.setAttribute('aria-expanded','true');
    tableHint.textContent = '0 × 0';
    tableGrid.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  }
  function closePicker() {
    tablePicker.classList.remove('open');
    btnTable.setAttribute('aria-expanded','false');
  }

  btnTable.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tablePicker.classList.contains('open')) closePicker(); else openPicker();
  });
  tablePicker.querySelector('.close').addEventListener('click', closePicker);
  document.addEventListener('click', (e) => {
    if (!tableWrap.contains(e.target)) closePicker();
  });

  tableGrid.addEventListener('mousemove', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const R = +btn.dataset.r, C = +btn.dataset.c;
    tableGrid.querySelectorAll('button').forEach(b => {
      const r = +b.dataset.r, c = +b.dataset.c;
      b.classList.toggle('active', r<=R && c<=C);
    });
    tableHint.textContent = `${R} × ${C}`;
  });
  tableGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    insertTable(+btn.dataset.r, +btn.dataset.c);
    closePicker();
  });

  // Chart builder
  function addChartStep(value='') {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Step';
    input.value = value;
    chartSteps.appendChild(input);
    return input;
  }
  function openChartBuilder() {
    chartBuilder.classList.add('open');
    btnChart.setAttribute('aria-expanded', 'true');
    chartSteps.innerHTML = '';
    addChartStep();
    addChartStep();
    const first = chartSteps.querySelector('input');
    if (first) first.focus();
  }
  function closeChartBuilder() {
    chartBuilder.classList.remove('open');
    btnChart.setAttribute('aria-expanded', 'false');
  }
  chartAddStep.addEventListener('click', () => { addChartStep(); });
  chartInsert.addEventListener('click', () => {
    const labels = [...chartSteps.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    if (labels.length < 2) { toast('Need at least two steps', 'warn'); return; }
    const ids = labels.map((_, i) => 'N' + i);
    let def = 'graph TD\n';
    for (let i=0; i<labels.length - 1; i++) {
      def += `${ids[i]}[${labels[i]}]-->${ids[i+1]}[${labels[i+1]}]\n`;
    }
    insertMermaidChart(def);
    closeChartBuilder();
  });
  btnChart.addEventListener('click', (e) => {
    e.stopPropagation();
    if (chartBuilder.classList.contains('open')) closeChartBuilder(); else openChartBuilder();
  });
  chartClose.addEventListener('click', closeChartBuilder);
  document.addEventListener('click', (e) => {
    if (!chartWrap.contains(e.target)) closeChartBuilder();
  });

  // Formatting buttons
  btnUndo.addEventListener('click', () => { editor.focus(); undo(); });
  btnBold.addEventListener('click', () => { editor.focus(); document.execCommand('bold'); normaliseInlineTags(); });
  btnItalic.addEventListener('click', () => { editor.focus(); document.execCommand('italic'); normaliseInlineTags(); });
  btnStrike.addEventListener('click', () => { editor.focus(); document.execCommand('strikeThrough'); normaliseInlineTags(); });

  $$('.btn-h').forEach(b => b.addEventListener('click', () => { editor.focus(); applyHeading(+b.dataset.h); }));

  btnSource.addEventListener('click', () => toggleSource());
  btnExport.addEventListener('click', exportMarkdown);
  toggleShortcuts.addEventListener('click', () => {
    const collapsed = shortcutsPanel.classList.toggle('collapsed');
    toggleShortcuts.setAttribute('aria-expanded', String(!collapsed));
    toggleShortcuts.textContent = collapsed ? '≡' : '×';
    document.body.classList.toggle('shortcuts-collapsed', collapsed);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const cmd = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { closePicker(); closeChartBuilder(); return; }
    if (!cmd) return;
    const k = e.key.toLowerCase();
    if (k === 'z'){ e.preventDefault(); undo(); }
    else if (k === 'b'){ e.preventDefault(); if (mode==='wysiwyg'){ document.execCommand('bold'); normaliseInlineTags(); } }
    else if (k === 'i'){ e.preventDefault(); if (mode==='wysiwyg'){ document.execCommand('italic'); normaliseInlineTags(); } }
    else if (k === 'e'){ e.preventDefault(); if (mode==='wysiwyg'){ document.execCommand('strikeThrough'); normaliseInlineTags(); } }
    else if (['1','2','3','4'].includes(k)){ e.preventDefault(); applyHeading(+k); }
    else if (k === '/'){ e.preventDefault(); toggleSource(); }
    else if (k === 'd'){ e.preventDefault(); toggleTheme(); }
    else if (k === 's'){ e.preventDefault(); exportMarkdown(); }
  });

  // Basic startup
  editor.addEventListener('input', () => { snapshot(); });
  editor.addEventListener('blur', () => normaliseInlineTags());

  // Public sample if user opens without a file
  const sample = [
    '# QuietMark',
    '',
    'Edit like normal text; export to Markdown when ready.',
    '',
    '## Short list',
    '',
    '- One',
    '- Two',
    '',
    '## Table',
    '',
    '| Name | Qty |',
    '| --- | ---:|',
    '| Apples | 3 |',
    '| Pears | 5 |',
    '',
    'Some **bold**, some _italic_, some ~~strike~~, and a [link](https://example.org).'
  ].join('\n');
  renderMarkdownToEditor(sample);

})();
