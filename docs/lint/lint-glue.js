/* glue code: wire the linter to your page, no build step needed */

/* Scriptor IDs */
const MD_INPUT   = document.querySelector("#source");   // raw markdown source
const PREVIEW_EL = document.querySelector("#editor");   // rendered editor

function getMarkdown(){
  if(MD_INPUT) return MD_INPUT.value;
  return document.body.innerText || "";
}

function jumpTo(from, to){
  if(!MD_INPUT) return;
  MD_INPUT.focus();
  MD_INPUT.setSelectionRange(from, to);
  MD_INPUT.scrollTop = MD_INPUT.scrollHeight * (from / MD_INPUT.value.length);
}

function addLintButton(){
  const btn = document.createElement("button");
  btn.textContent = "Run lint";
  btn.style.cssText = "position:fixed;right:360px;top:10px;z-index:10000;padding:6px 10px";
  btn.onclick = () => LintUI.run({
    getMarkdown,
    container: PREVIEW_EL || document.body,
    jumpTo,
    config: {
      sentenceWordLimit: 60,
      bannedPhrases: {
        "and/or":"choose one, and or or",
        "etc.":"be specific, remove etc.",
        "as appropriate":"say who decides, on what basis",
        "from time to time":"state frequency or trigger"
      },
      extraStopTerms: ["FSB","IB","TCB","ANLA","PII","RAE"]
    }
  });
  document.body.appendChild(btn);
}

document.addEventListener("DOMContentLoaded", addLintButton);

if(MD_INPUT){
  let t = null;
  MD_INPUT.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      LintUI.run({ getMarkdown, container: PREVIEW_EL || document.body, jumpTo });
    }, 1000);
  });
}
