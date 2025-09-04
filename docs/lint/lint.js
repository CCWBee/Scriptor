/* Lightweight Markdown linter with side panel UI
   User-facing name: "Check" */

const LintUI = (() => {
  function normalizeText(container){
    if(container && (container.nodeName === 'TEXTAREA' || container.nodeName === 'INPUT')){
      const text = container.value || '';
      return { text, map: [] };
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ALL, null);
    const map = [];
    let text = '';
    let offset = 0;
    let seenText = false;
    let pendingNL = false;

    function isBlock(el){
      if(el.nodeType !== 1) return false;
      const disp = window.getComputedStyle(el).display;
      return disp === 'block' || disp === 'flex' || disp === 'grid' || disp === 'list-item' || disp === 'table';
    }

    while(walker.nextNode()){
      const node = walker.currentNode;
      if(node.nodeType === Node.TEXT_NODE){
        if(pendingNL && seenText){ text += '\n'; offset++; }
        pendingNL = false;
        const start = offset;
        const content = node.textContent;
        text += content;
        offset += content.length;
        map.push({ node, start, end: offset });
        if(content.length) seenText = true;
      } else if(node.nodeName === 'BR'){
        if(seenText){ text += '\n'; offset++; }
        pendingNL = false;
      } else if(isBlock(node)){
        pendingNL = true;
      }
    }
    return { text, map };
  }

  function buildLineIndex(text){
    const idx = [0];
    for(let i = 0; i < text.length; i++){
      if(text[i] === '\n') idx.push(i + 1);
    }
    return idx;
  }

  function run(opts = {}){
    const container = opts.container || document.body;
    clearHighlights(container);
    const norm = normalizeText(container);
    const md = norm.text;
    const lineIdx = buildLineIndex(md);
    const cfg = Object.assign({
      sentenceWordLimit: 40,
      bannedPhrases: {},
      extraStopTerms: []
    }, opts.config || {});

    function toLineCol(idx){
      let lo = 0, hi = lineIdx.length - 1;
      while (lo <= hi){
        const mid = (lo + hi) >> 1;
        if(lineIdx[mid] <= idx) lo = mid + 1;
        else hi = mid - 1;
      }
      const line = hi + 1;
      const column = idx - lineIdx[hi] + 1;
      return { line, column };
    }

    const issues = [];

    // Check for long sentences
    const sentences = md.split(/(?<=[.!?])\s+/);
    let pos = 0;
    for(const s of sentences){
      const words = s.trim().split(/\s+/).filter(Boolean);
      if(words.length > cfg.sentenceWordLimit){
        const start = md.indexOf(s, pos);
        const end = start + s.length;
        const loc = toLineCol(start);
        issues.push({
          type: 'warn',
          message: `Sentence longer than ${cfg.sentenceWordLimit} words (${words.length})`,
          from: start,
          to: end,
          line: loc.line,
          column: loc.column,
          text: s
        });
      }
      pos += s.length + 1;
    }

    // Banned phrases
    for(const [phrase, data] of Object.entries(cfg.bannedPhrases)){
      let hint, wholeWord = true;
      if(typeof data === 'string'){
        hint = data;
      } else {
        hint = data && data.hint || '';
        if(data && data.wholeWord === false) wholeWord = false;
      }
      // Escape special regex characters so phrases are matched literally
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
      const re = new RegExp(pattern, 'gi');
      let m;
      while((m = re.exec(md))){
        const loc = toLineCol(m.index);
        issues.push({
          type: 'error',
          message: `Avoid "${phrase}" (${hint})`,
          from: m.index,
          to: m.index + m[0].length,
          line: loc.line,
          column: loc.column,
          text: m[0]
        });
      }
    }

    // Extra stop terms
    for(const t of cfg.extraStopTerms){
      let term, wholeWord = true;
      if(typeof t === 'string'){
        term = t;
      } else if(t){
        term = t.term;
        if(t.wholeWord === false) wholeWord = false;
      }
      if(!term) continue;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
      const re = new RegExp(pattern, 'gi');
      let m;
      while((m = re.exec(md))){
        const loc = toLineCol(m.index);
        issues.push({
          type: 'info',
          message: `Contains stop term "${term}"`,
          from: m.index,
          to: m.index + m[0].length,
          line: loc.line,
          column: loc.column,
          text: m[0]
        });
      }
    }

    renderPanel(issues, opts);
    highlight(container, issues);
  }

  function renderPanel(issues, opts){
    document.querySelectorAll('#lint-panel, #lint-tip').forEach(el => el.remove());

    const panel = document.createElement('div');
    panel.id = 'lint-panel';
    panel.innerHTML = `<header><h3>Check results (${issues.length})</h3><button id="lint-close">×</button></header><div id="lint-list"></div>`;
    const list = panel.querySelector('#lint-list');

    const tip = document.createElement('div');
    tip.id = 'lint-tip';
    document.body.appendChild(tip);

    const icons = { error: '⛔', warn: '⚠️', info: 'ℹ️' };

    issues.forEach((iss, i) => {
      const item = document.createElement('div');
      item.className = 'lint-item';
      item.dataset.issue = i;
      const loc = `Line ${iss.line}${iss.column ? ':' + iss.column : ''}`;
      const icon = icons[iss.type] || '';
      item.innerHTML = `<span class="lint-tag tag-${iss.type}"><span class="lint-icon">${icon}</span>${iss.type}</span>${escapeHtml(iss.message)}<div class="loc">${loc}</div>`;
      item.addEventListener('click', () => {
        if(typeof opts.jumpTo === 'function') opts.jumpTo(iss.from, iss.to);
        activateIssue(i);
      });
      item.addEventListener('mouseenter', e => {
        tip.textContent = iss.message;
        tip.style.display = 'block';
        tip.style.top = (e.clientY + 12) + 'px';
        tip.style.left = (e.clientX - tip.offsetWidth - 12) + 'px';
      });
      item.addEventListener('mouseleave', () => {
        tip.style.display = 'none';
      });
      list.appendChild(item);
    });

    panel.querySelector('#lint-close').onclick = () => panel.remove();
    document.body.appendChild(panel);
  }

  function highlight(container, issues){
    if(!container || !issues) return;

    issues.sort((a, b) => a.from - b.from);
    let map = normalizeText(container).map;

    issues.forEach((iss, i) => {
      const startEntry = map.find(m => iss.from >= m.start && iss.from < m.end);
      const endEntry = map.find(m => iss.to > m.start && iss.to <= m.end) || startEntry;
      if(!startEntry || !endEntry) return;
      const range = document.createRange();
      range.setStart(startEntry.node, iss.from - startEntry.start);
      range.setEnd(endEntry.node, iss.to - endEntry.start);
      const span = document.createElement('span');
      span.className = `lint-underline lint-${iss.type}`;
      span.dataset.issue = i;
      span.addEventListener('click', () => activateIssue(i));
      span.addEventListener('mouseenter', () => activateIssue(i));
      range.surroundContents(span);
      map = normalizeText(container).map;
    });
  }

  function clearHighlights(container){
    if(!container) return;
    container.querySelectorAll('.lint-underline').forEach(el => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });
  }

  function activateIssue(id){
    document.querySelectorAll('.lint-item').forEach(it => {
      if(it.dataset.issue == id){
        it.classList.add('selected');
        it.scrollIntoView({block: 'nearest'});
      } else {
        it.classList.remove('selected');
      }
    });
    document.querySelectorAll('.lint-underline').forEach(sp => {
      if(sp.dataset.issue == id){
        sp.classList.add('active');
      } else {
        sp.classList.remove('active');
      }
    });
  }

  function escapeHtml(str){
    return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  return { run };
})();
