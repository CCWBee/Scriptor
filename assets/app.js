// Scriptor editor
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
  const ribbon = $('.ribbon');
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
  const chartNodeTpl = $('#chartNodeTpl');
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
  const statusBar = $('#statusBar');

  // Prevent toolbar clicks from moving editor focus across input types
  function keepEditorFocus(e) {
    if (e.target.closest('button')) e.preventDefault();
  }
  ribbon.addEventListener('pointerdown', keepEditorFocus);
  ribbon.addEventListener('mousedown', keepEditorFocus);

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
  const DRAFT_KEY = 'draft';
  let lastSavedMd = '';
  let dirty = false;

  try {
    if (!window.markdownit || !window.DOMPurify || !window.TurndownService || !window.turndownPluginGfm) {
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

    if (window.mermaid) {
      mermaid.initialize({ startOnLoad: false });
    }
    updateChartButtonState();
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

  function getCurrentMarkdown() {
    let mdOut = '';
    if (mode === 'source') {
      mdOut = srcTA.value || '';
    } else {
      const clone = editor.cloneNode(true);
      normaliseInlineTags(clone);
      mdOut = td.turndown(clone.innerHTML);
    }
    const fmText = frontmatterToYAML(frontmatter);
    if (fmText) mdOut = `---\n${fmText}\n---\n\n` + mdOut;
    return mdOut;
  }

  function saveDraft(mdText) {
    try { localStorage.setItem(DRAFT_KEY, mdText); } catch (_) {}
    dirty = mdText !== lastSavedMd;
  }

  function handleInput() {
    const mdText = getCurrentMarkdown();
    saveDraft(mdText);
    const words = mdText.trim().split(/\s+/).filter(Boolean).length;
    const chars = mdText.length;
    statusBar.textContent = `${words} words • ${chars} chars`;
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
    if (!definition) return;
    if (mode === 'source') {
      const block = `\n\u0060\u0060\u0060mermaid\n${definition}\n\u0060\u0060\u0060\n`;
      const { selectionStart, selectionEnd } = srcTA;
      srcTA.setRangeText(block, selectionStart, selectionEnd, 'end');
      srcTA.focus();
      return;
    }
    if (mode !== 'wysiwyg') return;
    const sel = window.getSelection();
    if (savedRange) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
      savedRange = null;
    }
    if (!editor.contains(sel.anchorNode)) {
      const nr = document.createRange();
      nr.selectNodeContents(editor);
      nr.collapse(false);
      sel.removeAllRanges();
      sel.addRange(nr);
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
    const blank = document.createElement('p');
    blank.innerHTML = '<br>';
    div.insertAdjacentElement('afterend', blank);
    const nr = document.createRange();
    nr.selectNodeContents(blank);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
  }

  function renderMarkdownToEditor(markdown, fromLoad=false) {
    try{
      const { fm, body } = extractFrontmatter(markdown);
      frontmatter = fm;
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
    lastSavedMd = mdOut;
    saveDraft(mdOut);
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
      lastSavedMd = txt;
      saveDraft(txt);
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
      lastSavedMd = txt;
      saveDraft(txt);
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
    const toSource = typeof forceToSource === 'boolean' ? forceToSource : (mode === 'wysiwyg');
    closeChartBuilder();
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
    updateChartButtonState();
  }

  function updateChartButtonState() {
    const disabled = (mode !== 'wysiwyg') || !window.mermaid;
    btnChart.disabled = disabled;
    btnChart.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if (disabled) closeChartBuilder();
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
    closeChartBuilder();
    closeFrontmatter();
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
    closePicker();
    closeFrontmatter();
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
    const row = chartNodeTpl.content.firstElementChild.cloneNode(true);
    const input = row.querySelector('input');
    const select = row.querySelector('select');
    input.placeholder = 'Step ' + idx;
    input.value = text;
    input.addEventListener('input', updateChartPreview);
    select.addEventListener('change', updateChartPreview);
    chartNodes.appendChild(row);
    updateNodeOptions();
  }

  function updateNodeOptions(){
    const rows = [...chartNodes.children];
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    rows.forEach((row,i) => { row.dataset.id = letters[i]; });
    rows.forEach((row,i) => {
      const select = row.querySelector('select');
      const prev = [...select.selectedOptions].map(o => o.value);
      select.innerHTML = '';
      rows.forEach((r,j) => {
        if (i === j) return;
        const opt = document.createElement('option');
        opt.value = r.dataset.id;
        opt.textContent = r.dataset.id;
        if (prev.includes(opt.value)) opt.selected = true;
        select.appendChild(opt);
      });
    });
  }

  function buildMermaidCode(){
    updateNodeOptions();
    const dir = chartDir.value;
    const rows = [...chartNodes.children];
    const nodes = [];
    const active = new Set();
    rows.forEach(row => {
      const label = row.querySelector('input').value.trim();
      if (!label) return;
      nodes.push({ id: row.dataset.id, label, row });
      active.add(row.dataset.id);
    });
    if (!nodes.length) return '';
    let code = `graph ${dir}\n`;
    nodes.forEach(n => { code += `${n.id}["${n.label.replace(/"/g,'\\"')}"]\n`; });
    nodes.forEach(n => {
      const select = n.row.querySelector('select');
      [...select.selectedOptions].forEach(opt => {
        const to = opt.value;
        if (to && active.has(to)) code += `${n.id}-->${to}\n`;
      });
    });
    return code;
  }
  function updateChartPreview(){
    const code = buildMermaidCode();
    if (!code) { chartPreview.innerHTML = ''; return; }
    chartPreview.innerHTML = `<div class="mermaid">${code}</div>`;
    try{ mermaid.init(undefined, chartPreview.querySelector('.mermaid')); }catch(_){ }
  }
  const storeChartRange = () => { if (!btnChart.disabled) savedRange = getSelectionRange(); };
  btnChart.addEventListener('mousedown', storeChartRange);
  btnChart.addEventListener('click', storeChartRange);
  btnChart.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btnChart.disabled) return;
    if (chartBuilder.classList.contains('open')) closeChartBuilder(); else openChartBuilder();
  });
  chartAdd.addEventListener('click', () => {
    addChartNode();
    updateChartPreview();
    const last = chartNodes.lastElementChild;
    if (last) last.querySelector('input').focus();
  });
  chartDir.addEventListener('change', updateChartPreview);
  chartInsert.addEventListener('click', () => {
    const code = buildMermaidCode().trim();
    if (!code) { toast('Add at least one node', 'warn'); return; }
    insertMermaidChart(code);
    closeChartBuilder();
  });
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
      rm.addEventListener('click', () => { delete frontmatter[k]; renderFrontmatterList(); handleInput(); });
      li.appendChild(span); li.appendChild(rm);
      fmList.appendChild(li);
    });
  }
  function openFrontmatter(){
    closePicker();
    closeChartBuilder();
    renderFrontmatterList();
    fmEditor.classList.add('open');
    btnFrontmatter.setAttribute('aria-expanded','true');
    fmField.focus();
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
    handleInput();
  });
  btnFrontmatter.addEventListener('click', (e) => { e.stopPropagation(); if (fmEditor.classList.contains('open')) closeFrontmatter(); else openFrontmatter(); });
  fmClose.addEventListener('click', closeFrontmatter);

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
    if (e.key === 'Escape') { closePicker(); closeChartBuilder(); closeFrontmatter(); return; }
    if (!cmd) return;
    const k = e.key.toLowerCase();
    if (k === 'b'){ e.preventDefault(); if (mode==='wysiwyg'){ document.execCommand('bold'); normaliseInlineTags(); } }
    else if (k === 'i'){ e.preventDefault(); if (mode==='wysiwyg'){ document.execCommand('italic'); normaliseInlineTags(); } }
    else if (k === 'e'){ e.preventDefault(); if (mode==='wysiwyg'){ document.execCommand('strikeThrough'); normaliseInlineTags(); } }
    else if (['1','2','3','4'].includes(k)){ e.preventDefault(); applyHeading(+k); }
    else if (k === '/'){ e.preventDefault(); toggleSource(); }
    else if (k === 'd'){ e.preventDefault(); toggleTheme(); }
    else if (k === 's'){ e.preventDefault(); exportMarkdown(); }
  });

  // Basic startup
  editor.addEventListener('input', handleInput);
  srcTA.addEventListener('input', handleInput);
  editor.addEventListener('blur', () => normaliseInlineTags());

  // Public sample if user opens without a file
  const sample = [
    '# Scriptor',
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
  const savedDraft = (() => { try { return localStorage.getItem(DRAFT_KEY); } catch (_) { return null; } })();
  if (savedDraft) {
    renderMarkdownToEditor(savedDraft);
    lastSavedMd = savedDraft;
    saveDraft(savedDraft);
  } else {
    renderMarkdownToEditor(sample);
    lastSavedMd = sample;
    saveDraft(sample);
  }

  handleInput();

  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

})();
