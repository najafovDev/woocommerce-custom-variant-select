(function(){
  var selectors = [
    '.product form.cart',
    'form.cart[action*=\"add_to_cart\"]',
    '.single_add_to_cart_button',
    '.woocommerce .single_add_to_cart_button',
    '.elementor-widget-woocommerce-product-add-to-cart',
    '.elementor-widget-woocommerce-product-add-to-cart form',
    '.e-add-to-cart',
    '.woocommerce-variation-add-to-cart',
    '.woocommerce-variation-availability',
    '.variations_form',
    '.quantity',
    '.cart .button',
    '.cart .input-text.qty'
  ];

  function reveal(el){
    var changed = false;
    if (!el) return changed;
    var cs = window.getComputedStyle(el);
    if (cs && cs.display === 'none') { el.style.setProperty('display','block','important'); changed = true; }
    if (cs && cs.visibility === 'hidden') { el.style.setProperty('visibility','visible','important'); changed = true; }
    return changed;
  }

  function revealWithAncestors(el){
    var touched = 0, depth = 0, node = el;
    while (node && node !== document.body && depth < 6){
      if (reveal(node)) touched++;
      node = node.parentElement; depth++;
    }
    if (touched > 0) { el.setAttribute('data-wcvcl-guard','touched'); }
    return touched;
  }

  function run(){
    var hasBlock = !!document.querySelector('form.wcvcl-multi-form');
    if (hasBlock) { console.log('[wcvcl-guard] plugin block present; guard skipped'); return; }
    var total = 0, found = 0;
    selectors.forEach(function(sel){
      var list = document.querySelectorAll(sel);
      found += list.length;
      list.forEach(function(el){ total += revealWithAncestors(el); });
    });
    console.log('[wcvcl-guard] nodes found:', found, 'elements touched:', total);
  }

  function kickoff(){
    try { run(); } catch(e){ console.error('[wcvcl-guard] error', e); }
  }

  // Run now, then on DOM ready + window load
  kickoff();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kickoff);
  } else {
    setTimeout(kickoff, 0);
  }
  window.addEventListener('load', kickoff);

  // Re-run several times (covers lazy builders)
  var tries = 0, max = 14, iv = setInterval(function(){
    kickoff(); tries++; if (tries >= max) clearInterval(iv);
  }, 400);

  // Observe DOM changes for 6s
  var start = Date.now();
  var obs = new MutationObserver(function(){
    if (Date.now() - start > 6000) { obs.disconnect(); return; }
    kickoff();
  });
  try {
    obs.observe(document.documentElement, { childList:true, subtree:true });
  } catch(e) {
    // ignore
  }
})();