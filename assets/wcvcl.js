/* file: wc-variation-clicklist/assets/wcvcl.js */
(function ($) {
  function ensureBlockUI() {
    var j = window.jQuery || $;
    if (typeof j.unblockUI !== 'function') {
      if (j.fn && typeof j.fn.unblock === 'function') { j.unblockUI = function(){ try { j(document.body).unblock(); } catch(e){} }; }
      else { j.unblockUI = function(){}; }
    }
    if (typeof j.blockUI !== 'function') {
      if (j.fn && typeof j.fn.block === 'function') { j.blockUI = function(o){ try { j(document.body).block(o||{}); } catch(e){} }; }
      else { j.blockUI = function(){}; }
    }
    if (window.jQuery && (window.jQuery !== j)) {
      window.jQuery.unblockUI = j.unblockUI;
      window.jQuery.blockUI = j.blockUI;
    }
  }
  ensureBlockUI();
  $(document).on('wcpay_payment_request_update wc_stripe_display_error wc_fragments_loaded wc_fragments_refreshed added_to_cart', ensureBlockUI);
  setTimeout(ensureBlockUI, 0);
  setTimeout(ensureBlockUI, 200);
  setTimeout(ensureBlockUI, 1000);

  var QTY_STATE = new Map();
  var lastChangedStep = null;
  var normalizing = false;
  var normalizeScheduled = false;

  function scheduleNormalize(delay){
    if (normalizeScheduled) return;
    normalizeScheduled = true;
    setTimeout(function(){
      normalizeScheduled = false;
      normalizeSafe();
    }, typeof delay === 'number' ? delay : 50);
  }
  function normalizeSafe(){
    if (normalizing) return;
    normalizing = true;
    try {
      ensureBodyActive();
      sanitizeNativeDom();
      purgeOutsideClones();
      ensureSentinelAndPlace();
      normalizeIsland();
      relocatePRB();
      sanitizeNativeDom();
    } finally {
      normalizing = false;
    }
  }

  function n(v){ v = Number(v); return Number.isFinite(v) ? v : 0; }
  function money(a){
    var s = window.wcvclSettings || {};
    a = n(a);
    var d = typeof s.decimals === 'number' ? s.decimals : 2;
    var t = a.toFixed(d).split('.');
    t[0] = t[0].replace(/\B(?=(\d{3})+(?!\d))/g, (s.thousand || ','));
    var out = t.join((s.decimal || '.'));
    var sym = s.currency_symbol || '$';
    var pos = s.currency_pos || 'left';
    if (pos === 'left') return sym + out;
    if (pos === 'right') return out + sym;
    if (pos === 'left_space') return sym + ' ' + out;
    if (pos === 'right_space') return out + ' ' + sym;
    return sym + out;
  }
  function clamp(v,min,max){
    if (max === '' || max === undefined || max === null) return Math.max(min, v);
    return Math.max(min, Math.min(v, max));
  }
  function getVid($step){
    var vid = Number($step.data('vid'));
    return Number.isFinite(vid) ? vid : null;
  }
  function unit($row){
    var $amt = $row.find('.wcvcl-price-amount');
    var du = Number($amt.data('unit'));
    if (Number.isFinite(du)) return du;
    var $step = $row.find('.wcvcl-stepper');
    var u = $step.data('unitPrice');
    if (Number.isFinite(Number(u))) return Number(u);
    var txt = $amt.text();
    var t = ('' + txt).replace(/[^\d.,-]/g, '').replace(/\s/g, '');
    t = t.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    u = n(parseFloat(t));
    $step.data('unitPrice', u);
    return u;
  }
  function getQty($step){
    var vid = getVid($step);
    if (vid !== null && QTY_STATE.has(vid)) return QTY_STATE.get(vid);
    var raw = parseInt($step.find('.wcvcl-qty-input').val() || '0', 10);
    var v = isNaN(raw) ? 0 : raw;
    if (vid !== null) QTY_STATE.set(vid, v);
    return v;
  }
  function writeQtyToDom($step, val){
    var $inp = $step.find('.wcvcl-qty-input');
    var $badge = $step.find('.wcvcl-qty-badge');
    var maxAttr = $inp.data('max');
    var max = maxAttr === '' ? '' : parseInt(maxAttr, 10);
    var clamped = clamp(parseInt(val || '0', 10) || 0, 0, max);
    $inp.val(clamped);
    $badge.text(clamped);
    $step.find('.wcvcl-minus').prop('disabled', clamped <= 0);
    $step.find('.wcvcl-plus').prop('disabled', (max !== '') && (clamped >= max));
    return clamped;
  }
  function setQtyAtomic($step, newQty){
    var vid = getVid($step);
    var clamped;
    if (vid !== null) {
      var maxAttr = $step.find('.wcvcl-qty-input').data('max');
      var max = maxAttr === '' ? '' : parseInt(maxAttr, 10);
      clamped = clamp(parseInt(newQty || '0', 10) || 0, 0, max);
      QTY_STATE.set(vid, clamped);
    }
    clamped = writeQtyToDom($step, (vid !== null ? QTY_STATE.get(vid) : newQty));
    return clamped;
  }

  /* ----------------------------
     Native form helpers
  ---------------------------- */
  function resetNativeForm(){
    var form = $('.variations_form.cart');
    if (!form.length) return;
    form.find('select[name^="attribute_"], input[name^="attribute_"]').val('');
    form.find('input.variation_id').val('');
    var $qty = form.find('input.qty, input[name="quantity"]');
    if ($qty.length) { $qty.val('0'); }
    try { form.trigger('reset_data'); } catch (e) {}
  }

  // Formda var olan gerçek attribute alan adını bul (attribute_pa_* / attribute_* farkını otomatik çöz)
  function resolveAttrName($form, key){
    var raw = String(key);
    var base = raw.replace(/^attribute_/, '');
    var candidates = [];
    // en olası sıralama: exact → attribute_base → attribute_pa_base → attribute_base(sans pa)
    if (/^attribute_/.test(raw)) candidates.push(raw);
    candidates.push('attribute_' + base);
    if (!/^pa_/.test(base)) candidates.push('attribute_pa_' + base);
    else candidates.push('attribute_' + base.replace(/^pa_/, ''));
    // son çare: isim sonu eşleşmesi
    for (var i=0;i<candidates.length;i++){
      if ($form.find('[name="'+candidates[i]+'"]').length) return candidates[i];
    }
    var $fallback = $form.find('select[name^="attribute_"], input[name^="attribute_"]').filter(function(){
      return this.name.endsWith(base) || this.name.endsWith(base.replace(/^pa_/, ''));
    }).first();
    return $fallback.length ? $fallback.attr('name') : null;
  }

  function primeNativeFromStep($step, qty){
    var form = $('.variations_form.cart');
    if (!form.length) return;

    // 1) JSON’dan attribute’ları al
    var raw = $step.attr('data-attrs');
    var attrs = {};
    try { attrs = raw ? JSON.parse(raw) : {}; } catch (e) {}

    // 2) Her attribute için formda GERÇEK alan adını çöz ve yaz
    Object.keys(attrs).forEach(function(k){
      var targetName = resolveAttrName(form, k);
      if (!targetName) return;
      var $el = form.find('[name="'+targetName+'"]');
      var val = String(attrs[k]);
      if ($el.is('select')){
        // option var mı? varsa set + trigger
        if ($el.find('option[value="'+val+'"]').length) {
          $el.val(val);
        } else {
          // bazı temalar label yazıyor; mümkünse value yerine text’ten bul
          var byText = $el.find('option').filter(function(){ return $(this).text().trim().toLowerCase() === val.trim().toLowerCase(); }).attr('value');
          if (byText) $el.val(byText);
          else $el.val(val); // yine de yaz
        }
      } else {
        $el.val(val);
      }
    });

    // 3) Quantity yaz
    var $qty = form.find('input.qty'); if (!$qty.length) $qty = form.find('input[name="quantity"]');
    if ($qty.length) { $qty.val(qty); }

    // 4) Woo event zinciri (variation’ı Woo bulsun)
    form.find('select[name^="attribute_"], input[name^="attribute_"]').trigger('change');
    form.find('input.qty, input[name="quantity"]').trigger('input change keyup');
  }

  function fireNativeUpdate(){
    var form = $('.variations_form.cart');
    if (!form.length) return;
    try {
      var hasVid = !!form.find('input.variation_id').val();
      if (!hasVid) {
        form.trigger('check_variations woocommerce_variation_has_changed');
      }
      $(document.body).trigger('wcpay_payment_request_update stripeExpressCheckoutUpdate');
    } catch (e) {}
  }

  function renderRowTotalWith($row, qty){
    var u = unit($row);
    var $amt = $row.find('.wcvcl-price-amount');
    if ($amt.length) { $amt.text(money(qty > 0 ? (u * qty) : u)); }
    return u * qty;
  }
  function sumTotalsFromState($form){
    var total = 0, qtySum = 0;
    $form.find('.wcvcl-stepper').each(function(){
      var $s = $(this); var vid = getVid($s); if (vid === null) return;
      var q = QTY_STATE.get(vid) || 0;
      var u = unit($s.closest('.wcvcl-row'));
      total += q * u; qtySum += q;
    });
    $form.find('.wcvcl-bottom-total-price').text(money(total));
    $form.find('.wcvcl-direct-btn').prop('disabled', qtySum <= 0);
    return { qtySum: qtySum };
  }

  function ensureBodyActive(){
    try{
      var mount = document.getElementById('wcvcl-mount');
      if (mount && !document.body.classList.contains('wcvcl-active')) {
        document.body.classList.add('wcvcl-active');
      }
    }catch(e){}
  }

  function hideSoft(el){
    if (!el) return;
    el.setAttribute('data-wcvcl-hidden', '1');
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'absolute';
    el.style.left = '-99999px';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.overflow = 'hidden';
  }
  function sanitizeNativeDom(){
    try{
      var mount = document.getElementById('wcvcl-mount');
      if (!mount) return;
      var native = document.querySelector('.summary .variations_form.cart, .summary form.cart, form.cart.variations_form');
      if (!native) return;
      if (!native.classList.contains('wcvcl-native')) native.classList.add('wcvcl-native');
      native.querySelectorAll('.single_add_to_cart_button, button[name="add-to-cart"]').forEach(hideSoft);
      native.querySelectorAll('.quantity').forEach(hideSoft);
    }catch(e){}
  }

  function purgeOutsideClones(){
    var mount = document.getElementById('wcvcl-mount');
    if (!mount) return;
    var sel = '.wcvcl-row, .wcvcl-desc-row, .wcvcl-bottombar, .wcvcl-direct-btn, form.wcvcl-multi-form';
    document.querySelectorAll(sel).forEach(function(el){
      if (!mount.contains(el)) {
        try { el.remove(); } catch(e){}
      }
    });
  }

  function ensureAnchor(){
    var anchor = document.getElementById('wcvcl-anchor');
    if (anchor) return anchor;
    var summary = document.querySelector('.summary.entry-summary') || document.querySelector('.entry-summary') || document.querySelector('.product');
    var native = summary && (summary.querySelector('form.variations_form.cart') || summary.querySelector('form.cart'));
    if (!summary || !native) return null;
    anchor = document.createElement('div');
    anchor.id = 'wcvcl-anchor';
    anchor.style.display = 'none';
    try { native.parentNode.insertBefore(anchor, native); } catch(e){}
    return anchor;
  }
  function findSentinelPair(ctx){
    var start = null, end = null, n = ctx ? ctx.firstChild : null, hops = 0;
    while (n && hops < 400) {
      if (n.nodeType === 8 && /WCVCL-START/.test(n.nodeValue)) start = n;
      if (n.nodeType === 8 && /WCVCL-END/.test(n.nodeValue)) { end = n; break; }
      n = n.nextSibling; hops++;
    }
    return {start:start, end:end};
  }
  function ensureSentinelAndPlace(){
    var mount = document.getElementById('wcvcl-mount');
    if (!mount) return false;
    var anchor = ensureAnchor();
    if (!anchor || !anchor.parentNode) return false;
    var parent = anchor.parentNode;
    var pair = findSentinelPair(parent);
    var start = pair.start, end = pair.end;
    if (!start) {
      start = document.createComment(' WCVCL-START ');
      try { parent.insertBefore(start, anchor.nextSibling); } catch(e){}
    }
    if (!end) {
      end = document.createComment(' WCVCL-END ');
      try { parent.insertBefore(end, start.nextSibling); } catch(e){}
    }
    var betweenOk = false;
    var p = start.nextSibling, guard=0;
    while (p && p !== end && guard < 200) {
      if (p === mount) { betweenOk = true; break; }
      p = p.nextSibling; guard++;
    }
    if (!betweenOk) {
      try { parent.insertBefore(mount, end); } catch(e){}
    }
    return true;
  }

  function ensureSingleForm(mount){
    var forms = mount.querySelectorAll('form.wcvcl-multi-form');
    if (forms.length <= 1) return forms[0] || null;
    var keep = forms[0];
    for (var i=1;i<forms.length;i++){ try { forms[i].remove(); } catch(e){} }
    return keep;
  }
  function ensureBottomBar(form){
    var mount = document.getElementById('wcvcl-mount');
    if (!mount) return null;
    document.querySelectorAll('.wcvcl-bottombar').forEach(function(b){
      if (!mount.contains(b)) { try { b.remove(); } catch(e){} }
    });
    var bottom = mount.querySelector('#wcvcl-bottombar-root');
    if (!bottom) {
      bottom = document.createElement('div');
      bottom.className = 'wcvcl-bottombar';
      bottom.id = 'wcvcl-bottombar-root';
      bottom.innerHTML =
        '<div class="wcvcl-bottom-total"><span class="wcvcl-bottom-total-label">TOTAL:</span> '+
        '<span class="wcvcl-bottom-total-price">0</span></div>'+
        '<button type="button" class="wcvcl-direct-btn" disabled>ADD TO BASKET</button>';
      form.appendChild(bottom);
    } else if (bottom.parentElement !== form) {
      form.appendChild(bottom);
    }
    var totals = bottom.querySelectorAll('.wcvcl-bottom-total');
    for (var t = 1; t < totals.length; t++) { try { totals[t].remove(); } catch(e){} }
    var btns = bottom.querySelectorAll('.wcvcl-direct-btn');
    for (var k = 1; k < btns.length; k++) { try { btns[k].remove(); } catch(e){} }
    bottom.style.order = '100';
    return bottom;
  }
  function dedupeButtons(mount, form){
    document.querySelectorAll('.wcvcl-direct-btn').forEach(function(b){
      if (!mount.contains(b)) { try { b.remove(); } catch(e){} }
    });
    var btns = form.querySelectorAll('#wcvcl-bottombar-root .wcvcl-direct-btn');
    for (var i=1;i<btns.length;i++){ try { btns[i].remove(); } catch(e){} }
  }
  function normalizeIsland(){
    var mount = document.getElementById('wcvcl-mount'); if (!mount) return;
    var form = ensureSingleForm(mount); if (!form) return;
    var card = form.querySelector('.wcvcl-card'); if (!card) return;
    mount.querySelectorAll('.wcvcl-row, .wcvcl-desc-row').forEach(function(el){
      if (!card.contains(el)) { try { card.appendChild(el); } catch(e){} }
    });
    var bottom = ensureBottomBar(form);
    var express = mount.querySelector('#wcvcl-express');
    if (!express){ express = document.createElement('div'); express.id = 'wcvcl-express'; express.hidden = true; form.appendChild(express); }
    else if (express.parentElement !== form){ form.appendChild(express); }
    card.style.order = '0'; bottom && (bottom.style.order = '100'); express.style.order = '200';
    card.querySelectorAll('.wcvcl-row, .wcvcl-desc-row').forEach(function(el){ el.style.order = '0'; });
    dedupeButtons(mount, form);
    try {
      $('.summary.entry-summary .single_add_to_cart_button, .summary.entry-summary form.cart button[type="submit"]').css('display','none');
    } catch(e){}
  }

  function prbCandidates(){
    var arr = [];
    var a = document.getElementById('wc-stripe-express-checkout-element'); if (a) arr.push(a);
    var b = document.querySelector('.wcpay-payment-request-wrapper'); if (b) arr.push(b);
    var c = document.querySelector('.wc-stripe-payment-request-wrapper'); if (c) arr.push(c);
    var d = document.querySelector('.wc-block-components-express-payment'); if (d) arr.push(d);
    return arr.filter(Boolean);
  }

  function relocatePRBOnce(){
    var target = document.getElementById('wcvcl-express');
    if (!target) return false;
    var moved = false;
    prbCandidates().forEach(function(node){
      if (node.parentElement !== target) {
        try {
          target.appendChild(node);
          node.dataset.wcvclMoved = '1';
          moved = true;
        } catch(e){}
      }
    });
    if (moved) {
      try {
        target.hidden = false;
        target.classList.add('visible');
        var el = target.querySelector('#wc-stripe-express-checkout-element');
        if (el) {
          el.style.display = 'block';
          var iframe = el.querySelector('iframe');
          if (iframe) { iframe.style.minHeight = '52px'; iframe.style.opacity = '1'; iframe.style.visibility = 'visible'; }
        }
      } catch(e){}
    }
    return moved;
  }

  function relocatePRB(){
    var tries = 0, maxTries = 16;
    var tick = function(){
      var ok = relocatePRBOnce();
      tries++;
      if (!ok && tries < maxTries) {
        setTimeout(tick, 120);
      }
    };
    tick();
    return true;
  }

  function observeIsland(){
    try {
      var pending = false;
      var cb = function(){
        if (pending) return;
        pending = true;
        requestAnimationFrame(function(){ pending = false; scheduleNormalize(32); });
      };
      var mo = new MutationObserver(cb);
      mo.observe(document.body, { childList: true, subtree: true });
      setTimeout(function(){ try { mo.disconnect(); } catch(e){} }, 30000);
    } catch(e){}
  }

  function findActive($form){
    var found = null;
    $form.find('.wcvcl-stepper').each(function(){
      var $s = $(this);
      var q = getQty($s);
      if (q > 0 && !found) { found = { step: $s, vid: getVid($s) }; }
    });
    return found;
  }
  function setLockedVisuals($form, active){
    if (active){
      $form.find('.wcvcl-row').addClass('wcvcl-locked');
      active.step.closest('.wcvcl-row').removeClass('wcvcl-locked');
      $form.find('.wcvcl-plus,.wcvcl-minus').prop('disabled', true);
      active.step.find('.wcvcl-plus,.wcvcl-minus').prop('disabled', false);
    } else {
      $form.find('.wcvcl-row').removeClass('wcvcl-locked');
      $form.find('.wcvcl-plus,.wcvcl-minus').prop('disabled', false);
    }
  }
  function applyQtyChange($step, next){
    var $form = $step.closest('form.wcvcl-multi-form');
    var active = findActive($form);
    var thisVid = getVid($step);
    if (active && active.vid !== thisVid && next > 0) return;

    var q = setQtyAtomic($step, next);
    lastChangedStep = $step;

    // 1) Native’i doldur
    primeNativeFromStep($step, q);

    // 2) Görseller ve toplamlar
    renderRowTotalWith($step.closest('.wcvcl-row'), q);
    var res = sumTotalsFromState($form);
    active = findActive($form);
    setLockedVisuals($form, active);

    // 3) State’e göre update/reset
    if (res.qtySum > 0) { document.body.classList.add('wcvcl-active'); }
    else { document.body.classList.remove('wcvcl-active'); resetNativeForm(); }

    // 4) Woo/PRB update
    fireNativeUpdate();
    scheduleNormalize(16);
    sanitizeNativeDom();
  }

  function nativeNoticesWrapperOutside(){
    var mount = document.getElementById('wcvcl-mount');
    var cands = [];
    var summary = document.querySelector('.summary.entry-summary') || document.querySelector('.entry-summary') || document.querySelector('.product');
    if (summary) {
      cands = cands.concat([].slice.call(summary.querySelectorAll('.woocommerce-notices-wrapper')));
    }
    cands = cands.concat([].slice.call(document.querySelectorAll('.woocommerce-notices-wrapper')));
    for (var i=0;i<cands.length;i++){
      var w = cands[i];
      if (!mount || !w || !mount.contains(w)) return w;
    }
    return null;
  }
  function routeStripeErrorsToNative(){
    return;
  }

  function init(){
    ensureBodyActive();
    sanitizeNativeDom();
    $('.wcvcl-stepper').each(function(){
      var $s = $(this);
      var start = parseInt($s.find('.wcvcl-qty-input').val() || '0', 10) || 0;
      var v = setQtyAtomic($s, start);
      renderRowTotalWith($s.closest('.wcvcl-row'), v);
    });
    $('form.wcvcl-multi-form').each(function(){
      var $f = $(this);
      sumTotalsFromState($f);
      setLockedVisuals($f, findActive($f));
    });
    scheduleNormalize(10);
    observeIsland();
    var ex = document.getElementById('wcvcl-express');
    if (ex) { ex.hidden = false; ex.classList.add('visible'); }
    setTimeout(function(){ scheduleNormalize(32); sanitizeNativeDom(); }, 200);
    setTimeout(function(){ scheduleNormalize(32); relocatePRB(); sanitizeNativeDom(); }, 400);

    // PRB click – variation hazır değilse ilk tıkı iptal et, hazır olunca tek sefer daha tıkla
    (function(){
      var prbs = prbCandidates();
      if (!prbs.length) return;
      prbs.forEach(function(prb){
        prb.addEventListener('click', function(e){
          if (prb.__wcvclReclicking) return; // döngüden kaç
          var $active = $('.wcvcl-stepper').filter(function(){ return getQty($(this)) > 0; }).first();
          if (!$active.length) return;

          var q = getQty($active);
          primeNativeFromStep($active, q);

          var $form = $('.variations_form.cart');
          var tries = 0;
          var ready = function(){ return !!$form.find('input.variation_id').val(); };

          if (ready()){
            // zaten hazır: bir mikro-tick sonra update
            setTimeout(function(){ fireNativeUpdate(); }, 0);
            return;
          }

          // hazır değil: bu tıkı iptal et, kısa polling ile hazır olunca yeniden tıkla
          e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault();

          var poll = function(){
            tries++;
            if (ready() || tries > 8){ // max ~400ms
              prb.__wcvclReclicking = true;
              setTimeout(function(){ fireNativeUpdate(); prb.click(); prb.__wcvclReclicking = false; }, 0);
              return;
            }
            // Woo varyasyon bulsun
            try { $form.trigger('check_variations'); } catch(e){}
            setTimeout(poll, 50);
          };
          poll();
        }, {capture:true});
      });
    })();
  }

  $(document).on('found_variation show_variation woocommerce_variation_has_changed hide_variation reset_data', '.variations_form', function () {
    scheduleNormalize(32);
    sanitizeNativeDom();
  });
  $(document.body).on('wc_fragments_refreshed wc_fragments_loaded updated_wc_div added_to_cart', function () {
    scheduleNormalize(48);
    sanitizeNativeDom();
  });
  $(document).on('click', '.wcvcl-plus,.wcvcl-minus', function(){
    var $s = $(this).closest('.wcvcl-stepper');
    var cur = getQty($s);
    var next = $(this).hasClass('wcvcl-plus') ? cur + 1 : cur - 1;
    applyQtyChange($s, next);
  });
  $(document).on('change', '.wcvcl-qty-input', function(){
    var $s = $(this).closest('.wcvcl-stepper');
    var val = parseInt($(this).val() || '0', 10) || 0;
    applyQtyChange($s, val);
  });
  $(document).on('click', '.wcvcl-info', function(e){
    e.preventDefault(); e.stopPropagation();
    var $b = $(this);
    var t = $b.attr('data-target');
    var $p = t ? $(t) : $b.closest('.wcvcl-row').nextAll('.wcvcl-desc-row').first();
    if (!$p.length) return;
    var h = $p.prop('hidden');
    $p.prop('hidden', !h);
    $b.attr('aria-expanded', h ? 'true' : 'false');
  });
  $(document).on('click', '.wcvcl-direct-btn', function(e){
    e.preventDefault();
    var $f = $(this).closest('form.wcvcl-multi-form'); if (!$f.length) return;
    var active = $f.find('.wcvcl-stepper').filter(function(){ return getQty($(this)) > 0; }).first();
    if (!active.length) return;
    var q = getQty(active);
    primeNativeFromStep(active, q);
    fireNativeUpdate();
    sanitizeNativeDom();
    var $nativeForm = $('.variations_form.cart').first();
    var $nativeBtn = $nativeForm.find('.single_add_to_cart_button, button[name="add-to-cart"], button[type="submit"], input[type="submit"]').first();
    if ($nativeBtn.length) {
      $nativeBtn.trigger('click');
    } else if ($nativeForm.length) {
      try { $nativeForm.trigger('submit'); } catch(e){}
    }
  });

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
  $(window).on('load', function(){
    scheduleNormalize(32);
    sanitizeNativeDom();
  });

  $(document).on('wcpay_payment_error wc_stripe_display_error wc_stripe_payment_error checkout_error', function(){
    sanitizeNativeDom();
  });

  $(document).on('keydown', function(e){
    if (e.key === 'Tab') $('body').addClass('wcvcl-keynav');
  });
})(jQuery);
