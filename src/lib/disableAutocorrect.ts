// Turn off macOS/WKWebView text "assistance" (autocorrect, autocapitalize,
// autocomplete, spellcheck) across the whole app. Applied globally so every
// input/textarea and CodeMirror's contenteditable is covered, including
// elements React mounts after initial render.

const SELECTOR = "input, textarea, [contenteditable]";

function harden(el: Element) {
  el.setAttribute("autocorrect", "off");
  el.setAttribute("autocapitalize", "off");
  el.setAttribute("autocomplete", "off");
  el.setAttribute("spellcheck", "false");
}

export function disableAutocorrect() {
  document.querySelectorAll(SELECTOR).forEach(harden);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(SELECTOR)) harden(node);
        node.querySelectorAll(SELECTOR).forEach(harden);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
