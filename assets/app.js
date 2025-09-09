// Core client-side logic for the Scriptor Markdown editor
(() => {
  // Convenience DOM helpers
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // Grab all of the frequently used elements up front so the rest of the
  // code can refer to them without repeatedly querying the DOM.
  const editor = $('#editor');
  const srcTA = $('#source');
  const editorWrap = $('#editorWrap');
  const lineGutter = $('#lineGutter');
  const fileInput = $('#fileInput');
  const imgInput = $('#imgInput');
  const diffInput = $('#diffInput');
  const dropZone = $('#dropZone');
  const btnLoad = $('#btnLoad');
  const btnDiff = $('#btnDiff');
  const exportMenu = $('#exportMenu');
  // Only the backend understands these formats; the options get disabled until
  // the server confirms support.
  const backendFormats = ['pdf','docx','html'];
  backendFormats.forEach(fmt => {
    const opt = exportMenu.querySelector(`option[value="${fmt}"]`);
    if (opt) opt.disabled = true;
  });
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

  // ---------------------------------------------------------------------------
  // Tooltip handling
  // ---------------------------------------------------------------------------
  const tooltipDelay = 300;
  let tooltipTimer = null;
  let hideTooltipTimer = null;
  let tooltipBox = null;
  let tooltipOwner = null;

  function showTooltip(target) {
    clearTimeout(hideTooltipTimer);
    const reveal = () => {
      if (!tooltipBox) {
        tooltipBox = document.createElement('div');
        tooltipBox.className = 'tooltip';
        document.body.appendChild(tooltipBox);
      }
      tooltipBox.textContent = target.dataset.tip;
      const rect = target.getBoundingClientRect();
      tooltipBox.style.left = window.scrollX + rect.left + rect.width / 2 + 'px';
      tooltipBox.style.top = window.scrollY + rect.bottom + 'px';
      tooltipBox.style.transform = 'translate(-50%, 8px)';
      tooltipBox.style.transition = tooltipOwner ? 'none' : '';
      tooltipBox.classList.add('show');
      tooltipOwner = target;
    };
    if (tooltipOwner) {
      reveal();
    } else {
      tooltipTimer = setTimeout(reveal, tooltipDelay);
    }
  }

  function hideTooltip() {
    clearTimeout(tooltipTimer);
    hideTooltipTimer = setTimeout(() => {
      if (tooltipBox) tooltipBox.classList.remove('show');
      if (tooltipBox) tooltipBox.style.transition = '';
      tooltipOwner = null;
    }, 100);
  }

  function handleTooltipEnter(e) {
    const target = e.target.closest('[data-tip]');
    if (!target) return;
    showTooltip(target);
  }

  function handleTooltipLeave(e) {
    // Ignore pointer transitions within the current tooltip owner
    if (tooltipOwner && tooltipOwner.contains(e.relatedTarget)) return;
    const target = e.target.closest('[data-tip]');
    if (!target || target !== tooltipOwner) return;
    hideTooltip();
  }

  document.addEventListener('pointerover', handleTooltipEnter);
  document.addEventListener('focusin', handleTooltipEnter);
  document.addEventListener('pointerout', handleTooltipLeave);
  document.addEventListener('focusout', handleTooltipLeave);

  // Prevent toolbar clicks from moving editor focus across input types
  function keepEditorFocus(e) {
    if (e.target.closest('button')) e.preventDefault();
  }
  ribbon.addEventListener('pointerdown', keepEditorFocus);
  ribbon.addEventListener('mousedown', keepEditorFocus);

  // Show a temporary message in the bottom-right corner
  function toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = msg;
    toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade');
      el.addEventListener('transitionend', () => el.remove(), { once:true });
    }, 2400);
  }

  // ---------------------------------------------------------------------------
  // Application state variables
  // ---------------------------------------------------------------------------
  let mode = 'wysiwyg'; // 'wysiwyg' | 'source'
  let currentFileName = 'untitled.md';
  let md, td; // markdown-it and turndown instances
  let savedRange = null; // caret position when switching views
  let frontmatter = {}; // YAML frontmatter data
  const DRAFT_KEY = 'draft'; // localStorage key for unsaved work
  let lastSavedMd = '';
  let dirty = false; // whether there are unsaved changes
  let scrollPos = 0;

  function escapeHtml(str) {
    return str.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // Render an HTML diff where `originalText` is the baseline and `updatedText`
  // represents the new editor content.
  function renderDiff(originalText, updatedText) {
    if (!window.diff_match_patch) return '';
    const dmp = new diff_match_patch();
    const diffs = dmp.diff_main(originalText || '', updatedText || '');
    dmp.diff_cleanupSemantic(diffs);
    return diffs.map(([op, data]) => {
      const text = escapeHtml(data);
      if (op === 1) return `<span class="diff-add">${text}</span>`;
      if (op === -1) return `<span class="diff-del">${text}</span>`;
      return text;
    }).join('');
  }

  window.renderDiff = renderDiff;

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
  // expose for external scripts like the linter
  window.getCurrentMarkdown = getCurrentMarkdown;

  function saveDraft(editorText) {
    try { localStorage.setItem(DRAFT_KEY, editorText); } catch (_) {}
    dirty = editorText !== lastSavedMd;
    if (dirty) {
      const originalFileText = lastSavedMd;
      window.diffHtml = renderDiff(originalFileText, editorText);
    }
  }

  function updateLineNumbers() {
    const target = mode === 'source' ? srcTA : editor;
    const lineHeight = parseFloat(getComputedStyle(target).lineHeight);
    const lines = Math.ceil(target.scrollHeight / lineHeight);
    lineGutter.innerHTML = '';
    for (let i = 1; i <= lines; i++) {
      const div = document.createElement('div');
      div.textContent = i;
      lineGutter.appendChild(div);
    }
  }

  function handleInput() {
    const mdText = getCurrentMarkdown();
    saveDraft(mdText);
    const words = mdText.trim().split(/\s+/).filter(Boolean).length;
    const chars = mdText.length;
    statusBar.textContent = `${words} words • ${chars} chars`;
    if (editorWrap.classList.contains('show-line-numbers')) updateLineNumbers();
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

  async function exportDocument(format = 'md') {
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
    let name = (currentFileName || 'untitled').replace(/\.[^.]+$/, '');
    if (format === 'md') {
      name += '.md';
      const blob = new Blob([mdOut], { type: 'text/markdown;charset=utf-8' });
      triggerDownload(blob, name);
      lastSavedMd = mdOut;
      saveDraft(mdOut);
    } else {
      name += '.' + format;
      try {
        const blob = await pandocConvert(mdOut, format);
        triggerDownload(blob, name);
      } catch (err) {
        console.error(err);
        toast('Conversion failed', 'warn');
      }
    }
  }

  function triggerDownload(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast('Exported ' + name, 'success');
  }

  async function pandocConvert(markdown, format) {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown, format })
    });
    if (!res.ok) throw new Error('Conversion failed');
    return res.blob();
  }

  async function checkConvertEndpoint() {
    try {
      const res = await fetch('/api/convert', { method: 'OPTIONS' });
      if (!res.ok) throw new Error('Unavailable');
      backendFormats.forEach(fmt => {
        const opt = exportMenu.querySelector(`option[value="${fmt}"]`);
        if (opt) opt.disabled = false;
      });
    } catch (err) {
      console.warn('Conversion endpoint unavailable');
    }
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

  // Track changes / diff
  btnDiff.addEventListener('click', () => diffInput.click());
  diffInput.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const txt = await f.text();
      // First argument is the original file contents, second is the editor text
      showDiff(txt, getCurrentMarkdown());
    } catch(err) {
      console.error(err);
      toast('Failed to read diff file', 'warn');
    } finally {
      diffInput.value = '';
    }
  });

  function showDiff(originalText, editorText) {
    const diffs = diffLines(originalText, editorText);
    const html = diffs.map(part => {
      const esc = escapeHtml(part.line);
      if (part.type === 'add') return `<div class="added">+ ${esc}</div>`;
      if (part.type === 'del') return `<div class="removed">- ${esc}</div>`;
      return `<div>${esc}</div>`;
    }).join('\n');
    displayDiff(html);
  }

  function diffLines(originalText, updatedText) {
    const aL = originalText.split(/\r?\n/);
    const bL = updatedText.split(/\r?\n/);
    const m = aL.length, n = bL.length;
    const dp = Array.from({length: m + 1}, () => Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (aL[i] === bL[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (aL[i] === bL[j]) { out.push({type:'ctx', line:aL[i++]}); j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({type:'del', line:aL[i++]});
      else out.push({type:'add', line:bL[j++]});
    }
    while (i < m) out.push({type:'del', line:aL[i++]});
    while (j < n) out.push({type:'add', line:bL[j++]});
    return out;
  }

  function escapeHtml(str) {
    const map = {'&':'&amp;','<':'&lt;','>':'&gt;'};
    return str.replace(/[&<>]/g, ch => map[ch]);
  }

  function displayDiff(html) {
    let overlay = document.getElementById('diffOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'diffOverlay';
      const close = document.createElement('button');
      close.textContent = '×';
      close.className = 'close';
      close.addEventListener('click', () => overlay.remove());
      overlay.appendChild(close);
      const pre = document.createElement('pre');
      overlay.appendChild(pre);
      document.body.appendChild(overlay);
    }
    const pre = overlay.querySelector('pre');
    pre.innerHTML = html;
  }

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

  editor.addEventListener('click', (e) => {
    if (e.target.tagName === 'A' && (e.ctrlKey || e.metaKey)) {
      window.open(e.target.href, '_blank');
      e.preventDefault();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      editor.querySelectorAll('a').forEach(a => a.classList.add('ctrl-link'));
    }
  });
  document.addEventListener('keyup', (e) => {
    if (!e.ctrlKey && !e.metaKey) {
      editor.querySelectorAll('a').forEach(a => a.classList.remove('ctrl-link'));
    }
  });

  // Advanced toggle
  function toggleSource(forceToSource) {
    const toSource = typeof forceToSource === 'boolean' ? forceToSource : (mode === 'wysiwyg');
    closeChartBuilder();
    if (toSource) {
      // html -> md -> textarea
      scrollPos = window.scrollY;
      normaliseInlineTags();
      const html = editor.innerHTML;
      let mdOut = td.turndown(html);
      const fmText = frontmatterToYAML(frontmatter);
      if (fmText) mdOut = `---\n${fmText}\n---\n\n` + mdOut;
      srcTA.value = mdOut;
      editor.style.display = 'none';
      srcTA.style.display = 'block';
      srcTA.scrollTop = scrollPos;
      srcTA.focus({ preventScroll: true });
      window.scrollTo(0, scrollPos);
      btnSource.setAttribute('aria-pressed', 'true');
      mode = 'source';
    } else {
      // textarea -> html
      scrollPos = srcTA.scrollTop;
      const mdIn = srcTA.value || '';
      renderMarkdownToEditor(mdIn);
      srcTA.style.display = 'none';
      editor.style.display = 'block';
      editor.focus({ preventScroll: true });
      window.scrollTo(0, scrollPos);
      btnSource.setAttribute('aria-pressed', 'false');
      mode = 'wysiwyg';
    }
    updateChartButtonState();
    if (editorWrap.classList.contains('show-line-numbers')) updateLineNumbers();
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
  exportMenu.addEventListener('change', (e) => {
    const fmt = e.target.value;
    if (fmt) exportDocument(fmt);
    e.target.selectedIndex = 0;
  });
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
    else if (k === 'l'){ e.preventDefault(); editorWrap.classList.toggle('show-line-numbers'); if (editorWrap.classList.contains('show-line-numbers')) updateLineNumbers(); }
    else if (k === 's'){ e.preventDefault(); exportDocument(exportMenu.value || 'md'); }
  });

  editor.addEventListener('keydown', (e) => {
    if (mode !== 'wysiwyg') return;
    if (e.key !== 'Enter' && e.key !== 'Tab') return;

    const rng = getSelectionRange();
    if (!rng || !rng.collapsed) return;
    const block = findBlockAncestor(rng.startContainer);
    if (!block) return;

    const first = block.firstChild;
    const text = block.textContent;
    const match = text.match(/^(\d+(?:\.\d+)*)(?:\s|$)/);
    if (!match) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (text.trim() === match[1]) {
        const parent = block.previousElementSibling;
        if (parent) {
          const pm = parent.textContent.match(/^(\d+(?:\.\d+)*)(?:\s|$)/);
          if (pm) {
            const segs = pm[1].split('.');
            const last = parseInt(segs.pop(), 10) + 1;
            segs.push(String(last));
            const prefix = segs.join('.');
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(parent);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            block.remove();
            document.execCommand('insertParagraph');
            const sel2 = window.getSelection();
            if (sel2.rangeCount) {
              const r2 = sel2.getRangeAt(0);
              r2.collapse(true);
              sel2.removeAllRanges();
              sel2.addRange(r2);
            }
            document.execCommand('insertText', false, prefix + ' ');
            handleInput();
            return;
          }
        }
      }
      const segments = match[1].split('.').map(n => parseInt(n, 10));
      segments[segments.length - 1]++;
      const prefix = segments.join('.');
      document.execCommand('insertParagraph');
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.execCommand('insertText', false, prefix + ' ');
      handleInput();
    } else if (e.key === 'Tab') {
      if (e.shiftKey) {
        e.preventDefault();
        const segments = match[1].split('.');
        if (segments.length <= 1) return;
        segments.pop();
        const prefix = segments.join('.') + ' ';
        if (first && first.nodeType === 3) {
          const content = first.textContent;
          if (content.startsWith(match[0])) {
            first.textContent = prefix + content.slice(match[0].length);
          } else {
            first.textContent = prefix + content;
          }
        } else {
          block.insertBefore(document.createTextNode(prefix), first);
        }
        const sel = window.getSelection();
        const range = document.createRange();
        const node = block.firstChild;
        range.setStart(node, prefix.length);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        handleInput();
      } else if (/^\d+(?:\.\d+)*\s?$/.test(text)) {
        e.preventDefault();
        let prefix;
        const prev = block.previousElementSibling;
        if (prev) {
          const pm = prev.textContent.match(/^(\d+(?:\.\d+)*)/);
          if (pm) {
            prefix = pm[1] + '.1 ';
          }
        }
        if (!prefix) {
          const segments = match[1].split('.');
          segments.push('1');
          prefix = segments.join('.') + ' ';
        }
        if (first && first.nodeType === 3) {
          const content = first.textContent;
          if (content.startsWith(match[0])) {
            first.textContent = prefix + content.slice(match[0].length);
          } else {
            first.textContent = prefix + content;
          }
        } else {
          block.insertBefore(document.createTextNode(prefix), first);
        }
        const sel = window.getSelection();
        const range = document.createRange();
        const node = block.firstChild;
        range.setStart(node, prefix.length);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        handleInput();
      }
    }
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
    'Some **bold**, some _italic_, some ~~strike~~, and a [link](https://example.org).',
    '',
    '```mermaid',
    'graph TD',
    '  Start --> Stop',
    '```',
    '',
    '```js',
    'console.log("Hello, world!");',
    '```',
    '',
    '> A wise quote.',
    '',
    '---',
    '',
    '- [ ] Task one',
    '- [x] Task two',
    '',
    'Inline code: `const x = 42;`',
    '',
    '![Placeholder image](https://via.placeholder.com/150)'
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
  checkConvertEndpoint();

  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

})();
