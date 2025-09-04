/* glue code: wire the linter to your page, no build step needed */

/* Scriptor IDs */
const MD_INPUT   = document.querySelector("#source");   // raw markdown source
const PREVIEW_EL = document.querySelector("#editor");   // rendered editor
const BTN_CHECK  = document.querySelector("#btnCheck"); // toolbar button

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

function runLint(){
  LintUI.run({
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
}

if(BTN_CHECK){
  BTN_CHECK.addEventListener("click", runLint);
}

if(MD_INPUT){
  let t = null;
  MD_INPUT.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(runLint, 1000);
  });
}
