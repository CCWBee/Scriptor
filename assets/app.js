// QuietMark editor
(() => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // Elements
  const editor = $('#editor');
  const srcTA = $('#source');
  const fileInput = $('#fileInput');
  const imgInput = $('#imgInput');
  const dropZone = $('#dropZone');
  const btnLoad = $('#btnLoad');
  const btnExport = $('#btnExport');
  const btnSource = $('#btnSource');
  const btnBold = $('#btnBold');
  const btnItalic = $('#btnItalic');
  const btnStrike = $('#btnStrike');
  const btnUndo = $('#btnUndo');
  const btnImage = $('#btnImage');
  const btnLink = $('#btnLink');
  const tableWrap = $('.table-wrap');
  const tablePicker = $('#tablePicker');
  const tableGrid = tablePicker.querySelector('.grid');
  const tableHint = $('#tableHint');
  const btnTable = $('#btnTable');
  const btnChart = $('#btnChart');
  const chartWrap = $('.chart-wrap');
  const chartBuilder = $('#chartBuilder');
  const chartDir = $('#chartDir');
  const chartNodes = $('#chartNodes');
  const chartAdd = $('#chartAdd');
  const chartPreview = $('#chartPreview');
  const chartInsert = $('#chartInsert');
  const chartCancel = $('#chartCancel');
  const toasts = $('#toasts');
  const root = document.documentElement;
  const shortcutsPanel = $('#shortcuts');
  const toggleShortcuts = $('#toggleShortcuts');
  const frontWrap = $('.frontmatter-wrap');
  const btnFrontmatter = $('#btnFrontmatter');
  const fmEditor = $('#frontmatterEditor');
  const fmField = $('#fmField');
  const fmValue = $('#fmValue');
  const fmAdd = $('#fmAdd');
  const fmList = $('#fmList');
  const fmClose = $('#fmClose');
  const findWrap = $('.find-wrap');
  const btnFind = $('#btnFind');
  const findDialog = $('#findDialog');
  const findInput = $('#findInput');
  const replaceInput = $('#replaceInput');
  const findCase = $('#findCase');
  const findNextBtn = $('#findNext');
  const replaceBtn = $('#replaceOne');
  const replaceAllBtn = $('#replaceAll');
  const findClose = $('#findClose');

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
  let savedRange = null;
  let frontmatter = {};

  let libsOk = true;
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

    td.addRule('preserveBlank', {
      filter: (node) => node.nodeName === 'P' && node.innerHTML.trim() === '',
      replacement: () => '\n\n'
    });

    mermaid.initialize({ startOnLoad: false });
  } catch (err) {
    libsOk = false;
    console.error(err);
    toast('Required libraries failed to load', 'warn');
  }

  if (!libsOk) {
    [btnSource, btnExport].forEach(b => { b.disabled = true; b.setAttribute('aria-disabled', 'true'); });
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

  function extractFrontmatter(text) {
    const fm = {};
    if (text.startsWith('---')) {
      const end = text.indexOf('\n---', 3);
      if (end !== -1) {
        const fmText = text.slice(3, end).trim();
        fmText.split(/\r?\n/).forEach(line => {
          const idx = line.indexOf(':');
          if (idx !== -1) {
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            fm[key] = val;
          }
        });
        text = text.slice(end + 4);
        if (text.startsWith('\n')) text = text.slice(1);
      }
    }
    return { fm, body: text };
  }

  function frontmatterToYAML(obj) {
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join('\n');
  }

  const BLOCKS = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','TD','TH']);

  function findBlockAncestor(node) {
    while (node && node !== editor) {
      if (node.nodeType === 1 && BLOCKS.has(node.nodeName)) return node;
      node = node.parentNode;
    }
    return null;
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
    const blank = document.createElement('p');
    blank.innerHTML = '<br>';
    table.insertAdjacentElement('afterend', blank);
    const sel = window.getSelection();
    const nr = document.createRange();
    nr.selectNodeContents(blank);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
  }

  function insertMermaidChart(definition) {
    if (mode !== 'wysiwyg' || !definition) return;
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
      savedRange = null;
    }
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.setAttribute('contenteditable', 'false');
    div.dataset.code = definition;
    div.textContent = definition;
    const rng = getSelectionRange();
    if (rng) {
      rng.deleteContents();
      rng.insertNode(div);
    } else {
      editor.appendChild(div);
    }
    div.removeAttribute('data-processed');
    if (window.mermaid) mermaid.init(undefined, div);
  }

  function renderMarkdownToEditor(markdown, fromLoad=false) {
    try {
      const { fm, body } = extractFrontmatter(markdown);
      frontmatter = fm;
      if (!md || !DOMPurify) { editor.textContent = body; return; }
      const unsafe = md.render(body);
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
      if (fromLoad) editor.focus();
      editor.querySelectorAll('.mermaid').forEach(div => {
        div.removeAttribute('data-processed');
        if (window.mermaid) mermaid.init(undefined, div);
      });
    } catch(e) {
      console.error(e);
      toast('Failed to parse file', 'warn');
    }
  }

  function exportMarkdown() {
    if (!td) { toast('Export unavailable', 'warn'); return; }
    let mdOut = '';
    if (mode === 'source') {
      mdOut = srcTA.value || '';
    } else {
      normaliseInlineTags();
      const html = editor.innerHTML;
      mdOut = td.turndown(html);
    }
    const fmText = frontmatterToYAML(frontmatter);
    if (fmText) mdOut = `---\n${fmText}\n---\n\n` + mdOut;
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

  function setTheme(theme){
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch(_){ }
  }

  function toggleTheme(){
    const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  setTheme(localStorage.getItem('theme') || 'light');

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
  });

  // Advanced toggle
  function toggleSource(forceToSource) {
    if (!td) { toast('Advanced mode unavailable', 'warn'); return; }
    const toSource = typeof forceToSource === 'boolean' ? forceToSource : (mode === 'wysiwyg');
    if (toSource) {
      // html -> md -> textarea
      normaliseInlineTags();
      const html = editor.innerHTML;
      let mdOut = td.turndown(html);
      const fmText = frontmatterToYAML(frontmatter);
      if (fmText) mdOut = `---\n${fmText}\n---\n\n` + mdOut;
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
    if (!chartWrap.contains(e.target)) closeChartBuilder();
    if (!frontWrap.contains(e.target)) closeFrontmatter();
    if (!findWrap.contains(e.target)) closeFind();
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
  function resetChartBuilder(){
    chartDir.value = 'TD';
    chartNodes.innerHTML = '';
    addChartNode();
    addChartNode();
    updateChartPreview();
  }
  function openChartBuilder(){
    chartBuilder.classList.add('open');
    btnChart.setAttribute('aria-expanded','true');
    resetChartBuilder();
    const first = chartNodes.querySelector('input');
    if (first) first.focus();
  }
  function closeChartBuilder(){
    chartBuilder.classList.remove('open');
    btnChart.setAttribute('aria-expanded','false');
  }
  function addChartNode(text=''){
    const idx = chartNodes.children.length + 1;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Step ' + idx;
    input.value = text;
    input.addEventListener('input', updateChartPreview);
    chartNodes.appendChild(input);
  }
  function buildMermaidCode(){
    const dir = chartDir.value;
    const inputs = [...chartNodes.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    if (!inputs.length) return '';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = `graph ${dir}\n`;
    for (let i=0;i<inputs.length;i++){
      const id = letters[i];
      code += `${id}["${inputs[i].replace(/"/g,'\\"')}"]\n`;
      if (i < inputs.length-1) code += `${id}-->${letters[i+1]}\n`;
    }
    return code;
  }
  function updateChartPreview(){
    const code = buildMermaidCode();
    if (!code) { chartPreview.innerHTML = ''; return; }
    chartPreview.innerHTML = `<div class="mermaid">${code}</div>`;
    try{ mermaid.init(undefined, chartPreview.querySelector('.mermaid')); }catch(_){ }
  }
  btnChart.addEventListener('mousedown', () => { if (mode !== 'wysiwyg') return; savedRange = getSelectionRange(); });
  btnChart.addEventListener('click', (e) => {
    e.stopPropagation();
    if (chartBuilder.classList.contains('open')) closeChartBuilder(); else openChartBuilder();
  });
  chartAdd.addEventListener('click', () => { addChartNode(); updateChartPreview(); chartNodes.lastChild.focus(); });
  chartDir.addEventListener('change', updateChartPreview);
  chartInsert.addEventListener('click', () => { const code = buildMermaidCode(); if (code.trim()) insertMermaidChart(code); closeChartBuilder(); });
  chartCancel.addEventListener('click', closeChartBuilder);

  function renderFrontmatterList(){
    fmList.innerHTML = '';
    Object.entries(frontmatter).forEach(([k,v]) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = `${k}: ${v}`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.addEventListener('click', () => { delete frontmatter[k]; renderFrontmatterList(); });
      li.appendChild(span); li.appendChild(rm);
      fmList.appendChild(li);
    });
  }
  function openFrontmatter(){
    renderFrontmatterList();
    fmEditor.classList.add('open');
    btnFrontmatter.setAttribute('aria-expanded','true');
  }
  function closeFrontmatter(){
    fmEditor.classList.remove('open');
    btnFrontmatter.setAttribute('aria-expanded','false');
  }
  fmAdd.addEventListener('click', () => {
    const k = fmField.value.trim();
    const v = fmValue.value.trim();
    if (!k) return;
    frontmatter[k] = v;
    fmField.value = ''; fmValue.value = '';
    renderFrontmatterList();
  });
  btnFrontmatter.addEventListener('click', (e) => { e.stopPropagation(); if (fmEditor.classList.contains('open')) closeFrontmatter(); else openFrontmatter(); });
  fmClose.addEventListener('click', closeFrontmatter);

  let lastFindIndex = 0;
  function openFind(){
    findDialog.classList.add('open');
    btnFind.setAttribute('aria-expanded','true');
    findInput.focus();
  }
  function closeFind(){
    findDialog.classList.remove('open');
    btnFind.setAttribute('aria-expanded','false');
    lastFindIndex = 0;
  }
  function escapeRegExp(str){ return str.replace(/[.*+?^${}()|[\]\]/g, '\$&'); }
  function selectTextInEditor(start, length){
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    let pos = 0, node;
    while ((node = walker.nextNode())) {
      const next = pos + node.textContent.length;
      if (start < next) {
        const range = document.createRange();
        range.setStart(node, start - pos);
        let endNode = node, endOffset = start - pos + length;
        while (endOffset > endNode.textContent.length) {
          endOffset -= endNode.textContent.length;
          endNode = walker.nextNode();
          if (!endNode) break;
        }
        if (endNode) {
          range.setEnd(endNode, endOffset);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          editor.focus();
        }
        break;
      }
      pos = next;
    }
  }
  function findNext(){
    const term = findInput.value;
    if (!term) return;
    const content = mode === 'wysiwyg' ? editor.textContent : srcTA.value;
    const hay = findCase.checked ? content : content.toLowerCase();
    const needle = findCase.checked ? term : term.toLowerCase();
    const idx = hay.indexOf(needle, lastFindIndex);
    if (idx === -1) { toast('No more matches', 'warn'); lastFindIndex = 0; return; }
    if (mode === 'wysiwyg') selectTextInEditor(idx, term.length);
    else { srcTA.focus(); srcTA.setSelectionRange(idx, idx + term.length); }
    lastFindIndex = idx + term.length;
  }
  function replaceCurrent(){
    const term = findInput.value;
    if (!term) return;
    if (mode === 'wysiwyg') {
      const sel = window.getSelection();
      if (!sel.rangeCount) { findNext(); return; }
      const selected = sel.toString();
      const cmpSel = findCase.checked ? selected : selected.toLowerCase();
      const cmpTerm = findCase.checked ? term : term.toLowerCase();
      if (cmpSel !== cmpTerm) { findNext(); return; }
      document.execCommand('insertText', false, replaceInput.value);
    } else {
      const start = srcTA.selectionStart;
      const end = srcTA.selectionEnd;
      const selected = srcTA.value.substring(start, end);
      const cmpSel = findCase.checked ? selected : selected.toLowerCase();
      const cmpTerm = findCase.checked ? term : term.toLowerCase();
      if (cmpSel !== cmpTerm) { findNext(); return; }
      srcTA.setRangeText(replaceInput.value, start, end, 'end');
      srcTA.setSelectionRange(start + replaceInput.value.length, start + replaceInput.value.length);
    }
    lastFindIndex = mode === 'wysiwyg' ? lastFindIndex : srcTA.selectionStart;
  }
  function replaceAll(){
    const term = findInput.value;
    if (!term) return;
    const flags = findCase.checked ? 'g' : 'gi';
    const re = new RegExp(escapeRegExp(term), flags);
    if (mode === 'wysiwyg') {
      editor.innerHTML = editor.innerHTML.replace(re, replaceInput.value);
    } else {
      srcTA.value = srcTA.value.replace(re, replaceInput.value);
    }
    lastFindIndex = 0;
  }
  btnFind.addEventListener('click', (e) => { e.stopPropagation(); if (findDialog.classList.contains('open')) closeFind(); else openFind(); });
  findClose.addEventListener('click', closeFind);
  findNextBtn.addEventListener('click', findNext);
  replaceBtn.addEventListener('click', replaceCurrent);
  replaceAllBtn.addEventListener('click', replaceAll);

  // Formatting buttons
  btnUndo.addEventListener('click', () => {
    if (mode === 'wysiwyg') editor.focus(); else srcTA.focus();
    document.execCommand('undo');
  });
  btnBold.addEventListener('click', () => { editor.focus(); document.execCommand('bold'); normaliseInlineTags(); });
  btnItalic.addEventListener('click', () => { editor.focus(); document.execCommand('italic'); normaliseInlineTags(); });
  btnStrike.addEventListener('click', () => { editor.focus(); document.execCommand('strikeThrough'); normaliseInlineTags(); });
  btnImage.addEventListener('mousedown', () => {
    if (mode !== 'wysiwyg') return;
    savedRange = getSelectionRange();
  });
  btnImage.addEventListener('click', () => { if (mode !== 'wysiwyg') return; imgInput.click(); });
  btnLink.addEventListener('click', () => {
    if (mode !== 'wysiwyg') return;
    const url = prompt('URL', 'https://');
    if (!url) return;
    editor.focus();
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      document.execCommand('createLink', false, url);
    } else {
      const text = prompt('Link text', url);
      if (!text) return;
      document.execCommand('insertHTML', false, `<a href="${url}">${text}</a>`);
    }
  });
  imgInput.addEventListener('change', () => {
    const file = imgInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      editor.focus();
      const dataUrl = reader.result;
      const alt = prompt('Alt text', '') || '';
      const safeAlt = alt.replace(/"/g, '&quot;');
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = safeAlt;
      const rng = getSelectionRange();
      if (rng) {
        rng.deleteContents();
        rng.insertNode(img);
      } else {
        editor.appendChild(img);
      }
      const blank = document.createElement('p');
      blank.innerHTML = '<br>';
      img.insertAdjacentElement('afterend', blank);
      const sel = window.getSelection();
      const nr = document.createRange();
      nr.selectNodeContents(blank);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
      savedRange = null;
    };
    reader.readAsDataURL(file);
    imgInput.value = '';
  });

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
    if (e.key === 'Escape') { closePicker(); closeChartBuilder(); closeFrontmatter(); closeFind(); return; }
    if (!cmd) return;
    const k = e.key.toLowerCase();
    if (k === 'b'){ e.preventDefault(); if (mode==='wysiwyg'){ document.execCommand('bold'); normaliseInlineTags(); } }
    else if (k === 'i'){ e.preventDefault(); if (mode==='wysiwyg'){ document.execCommand('italic'); normaliseInlineTags(); } }
    else if (k === 'e'){ e.preventDefault(); if (mode==='wysiwyg'){ document.execCommand('strikeThrough'); normaliseInlineTags(); } }
    else if (['1','2','3','4'].includes(k)){ e.preventDefault(); applyHeading(+k); }
    else if (k === '/'){ e.preventDefault(); toggleSource(); }
    else if (k === 'd'){ e.preventDefault(); toggleTheme(); }
    else if (k === 's'){ e.preventDefault(); exportMarkdown(); }
    else if (k === 'f'){ e.preventDefault(); if (findDialog.classList.contains('open')) closeFind(); else openFind(); }
  });

  // Basic startup
  editor.addEventListener('input', () => { /* keep DOM tidy */ });
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
