/* Lightweight Markdown linter with side panel UI */

const LintUI = (() => {
  function run(opts = {}){
    const md = (opts.getMarkdown ? opts.getMarkdown() : "") || "";
    const cfg = Object.assign({
      sentenceWordLimit: 40,
      bannedPhrases: {},
      extraStopTerms: []
    }, opts.config || {});

    const issues = [];

    // Check for long sentences
    const sentences = md.split(/(?<=[.!?])\s+/);
    let pos = 0;
    for(const s of sentences){
      const words = s.trim().split(/\s+/).filter(Boolean);
      if(words.length > cfg.sentenceWordLimit){
        const start = md.indexOf(s, pos);
        const end = start + s.length;
        issues.push({
          type: 'warn',
          message: `Sentence longer than ${cfg.sentenceWordLimit} words (${words.length})`,
          from: start,
          to: end,
          text: s
        });
      }
      pos += s.length + 1;
    }

    // Banned phrases
    for(const [phrase, hint] of Object.entries(cfg.bannedPhrases)){
      const re = new RegExp(phrase, 'gi');
      let m;
      while((m = re.exec(md))){
        issues.push({
          type: 'error',
          message: `Avoid "${phrase}" (${hint})`,
          from: m.index,
          to: m.index + m[0].length,
          text: m[0]
        });
      }
    }

    // Extra stop terms
    for(const term of cfg.extraStopTerms){
      const re = new RegExp(term, 'gi');
      let m;
      while((m = re.exec(md))){
        issues.push({
          type: 'info',
          message: `Contains stop term "${term}"`,
          from: m.index,
          to: m.index + m[0].length,
          text: m[0]
        });
      }
    }

    renderPanel(issues, opts);
    highlight(opts.container || document.body, issues);
  }

  function renderPanel(issues, opts){
    document.querySelectorAll('#lint-panel, #lint-tip').forEach(el => el.remove());

    const panel = document.createElement('div');
    panel.id = 'lint-panel';
    panel.innerHTML = `<header><h3>Lint results (${issues.length})</h3><button id="lint-close">×</button></header><div id="lint-list"></div>`;
    const list = panel.querySelector('#lint-list');

    const tip = document.createElement('div');
    tip.id = 'lint-tip';
    document.body.appendChild(tip);

    issues.forEach((iss, i) => {
      const item = document.createElement('div');
      item.className = 'lint-item';
      item.innerHTML = `<span class="lint-tag tag-${iss.type}">${iss.type}</span>${escapeHtml(iss.message)}<div class="loc">${iss.from}-${iss.to}</div>`;
      item.addEventListener('click', () => {
        if(typeof opts.jumpTo === 'function') opts.jumpTo(iss.from, iss.to);
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
    if(!container) return;

    container.querySelectorAll('.lint-underline').forEach(el => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);

    issues.forEach(iss => {
      let start = iss.from, end = iss.to, count = 0;
      for(const node of nodes){
        const len = node.textContent.length;
        if(count + len < start){
          count += len;
          continue;
        }
        const s = Math.max(0, start - count);
        const e = Math.min(len, end - count);
        if(s >= len) break;
        const range = document.createRange();
        range.setStart(node, s);
        range.setEnd(node, e);
        const span = document.createElement('span');
        span.className = `lint-underline lint-${iss.type}`;
        range.surroundContents(span);
        break;
      }
    });
  }

  function escapeHtml(str){
    return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  return { run };
})();
