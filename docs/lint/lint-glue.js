/* glue code: wire the text checker to your page, no build step needed
   User-facing name: "Check text" */

/* Scriptor IDs */
const MD_INPUT   = document.querySelector("#source");   // raw markdown source
const PREVIEW_EL = document.querySelector("#editor");   // rendered editor
const BTN_CHECK  = document.querySelector("#btnCheck"); // toolbar button for "Check text"

function jumpTo(from, to){
  if(!MD_INPUT) return;
  MD_INPUT.focus();
  MD_INPUT.setSelectionRange(from, to);
  MD_INPUT.scrollTop = MD_INPUT.scrollHeight * (from / MD_INPUT.value.length);
}

function runCheck(){
  let md = "";
  let container = document.body;

  if(MD_INPUT && MD_INPUT.value.trim()){
    md = MD_INPUT.value;
    container = MD_INPUT;
  } else if(window.getCurrentMarkdown){
    md = window.getCurrentMarkdown() || "";
    container = PREVIEW_EL || document.body;
  } else if(PREVIEW_EL){
    md = PREVIEW_EL.innerText || "";
    container = PREVIEW_EL;
  } else {
    md = document.body.innerText || "";
  }

  LintUI.run({
    getMarkdown: () => md,
    container,
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
  BTN_CHECK.addEventListener("click", runCheck);
}

if(MD_INPUT){
  let t = null;
  MD_INPUT.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(runCheck, 1000);
  });
}
