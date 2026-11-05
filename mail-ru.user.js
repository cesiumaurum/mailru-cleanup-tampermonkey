// ==UserScript==
// @name         Mail.ru — убрать рекламу на главной
// @namespace    local.mailru.cleanup
// @version      1.9.1
// @description  Оставляет на главной Mail.ru почту, поиск и верхнее меню. Скрывает рекламные блоки веб-почты.
// @match        https://mail.ru/*
// @match        https://www.mail.ru/*
// @match        https://e.mail.ru/*
// @run-at       document-start
// @noframes
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==
(() => {
  'use strict';
  if (location.hostname === 'e.mail.ru') {
    // Persistent CSS applies to late inserts and SPA route changes automatically.
    // Do not classify messages by their text, inspect message frames, or hide a whole column.
    const protectedAreas = ':is(.letter-body, .letter__body, .letter__body-content, .js-readmsg-msg, [data-testid="letter-body"], [contenteditable="true"])';
    const adSlots = [
      '[data-rb-slot]', '[data-ad-slot]', '.advert-column', '#wrap-banner-top',
      '[data-sid="fulltext_wiget_promo"]', '[data-card-template-id="promo-widget-card-template"]',
      '.letter-list-item-adv', 'a[class^="rb-"][class*="branding"]',
      'iframe[src^="https://ad.mail.ru/"]'
    ];
    // Octavius places LetterListItemAdv immediately before LetterHeaderActions.
    // These rules match the slot even while it is empty and even when the creative's
    // children are opaque. They apply on both the inbox and separate read-letter URLs.
    const pane = ':is([data-qa-id="letter-content"],.application-mail__letter-content)';
    const nativeSlot = ':is([data-qa-id="native-adv"],.letter-list-item-adv,.letter-list-item-adv_topline,.spec-project-letter,[data-qa-is-topline="1"][data-qa-placement-name])';
    const menu = ':is(.new-menu.content-header,[class~="content-header"])';
    const nextToMenu = ':has(+ ' + menu + ', + :is(div,section) > ' + menu + ')';
    const guard = ':not(:is(header,nav,form,dialog,[role="toolbar"],[role="dialog"],[role="alert"],[role="status"],.content-header))' +
      ':not(:has(header,nav,form,dialog,[role="toolbar"],[role="alert"],[role="status"],.content-header))' +
      ':not(' + protectedAreas + ', ' + protectedAreas + ' *):not(:has(' + protectedAreas + '))';
    const fixedSlots = [
      nativeSlot + guard,
      pane + ' > :is(div,section,aside,iframe):first-child' + nextToMenu + guard,
      pane + ' > :is(div,section):has(> ' + nativeSlot + ')' + nextToMenu + guard
    ].join(',\n');
    const safeSelectors = adSlots.map(slot => slot + ':not(' + protectedAreas + ', ' + protectedAreas + ' *):not(:has(' + protectedAreas + '))');
    const attr = 'data-mailru-top-banner';
    const slotCSS = [fixedSlots, ...safeSelectors, '[' + attr + ']'].join(',\n') + ' { display:none !important; }';
    // Constructed CSS survives re-creation of <head> by the app.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(slotCSS);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets,sheet];
    } catch { GM_addStyle(slotCSS); }
    // Mail's locator rewrites the selectors of its own stylesheet. The painted ad row
    // retains this combination of declarations in the desktop portal's bundle.
    const rowColor = 'var(--vkui--octavius_color_list_letter_adv_background)';
    const mappedSlots = new Set();
    const inspected = new WeakMap();
    const rootClasses = new Set(['.letter-list-item-adv','.spec-project-letter']);
    let detectedSlots = fixedSlots, mappedSheet;
    let nextSheetCheck = 0;
    function refreshSlotNames() {
      mappedSlots.clear();
      for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
        if (sheet.disabled || sheet.ownerNode?.closest(protectedAreas)) continue;
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        const cached = inspected.get(sheet);
        if (cached && cached.count === rules.length) {
          for (const name of cached.names) mappedSlots.add(name);
          continue;
        }
        const names = new Set();
        for (const rule of rules) {
          const style = rule.style;
          if (!rule.selectorText || !style) continue;
          const selectors = rule.selectorText.split(',').map(s => s.trim());
          const isAdRow = style.backgroundColor === rowColor && style.overflow === 'hidden' &&
            style.position === 'relative' && /^translateZ\(0(?:px)?\)$/i.test(style.transform) &&
            style.userSelect === 'none';
          if (!isAdRow && !selectors.some(s => rootClasses.has(s))) continue;
          for (const name of selectors) if (/^\.[\w-]+$/.test(name) && !rootClasses.has(name)) names.add(name);
        }
        inspected.set(sheet,{count:rules.length,names});
        for (const name of names) mappedSlots.add(name);
      }
      const alias = mappedSlots.size ? ':is(' + [...mappedSlots].join(',') + ')' + guard : '';
      const selectors = alias ? fixedSlots + ',' + alias : fixedSlots;
      if (selectors !== detectedSlots) {
        detectedSlots = selectors;
        try {
          if (!mappedSheet) {
            mappedSheet = new CSSStyleSheet();
            document.adoptedStyleSheets = [...document.adoptedStyleSheets,mappedSheet];
          }
          mappedSheet.replaceSync(alias ? alias + ' {display:none !important}' : '');
        } catch { /* The DOM pass applies the same selectors. */ }
      }
    }
    const marker = /р[еe]кл[аa]м[аa][\s\u200b·|•]*\d{1,2}\s*\+/iu;
    const hiddenBanners = new Map();
    function readingLetter() {
      return new URLSearchParams(location.search).get('open-multipage-name') === 'read-letter' ||
        /^\/(?:\d+|(?:messages\/)?(?:inbox|sent|spam|trash|folder\d+))\/[^/]+|^\/message\//.test(location.pathname);
    }
    function hide(el, reason) {
      if (!hiddenBanners.has(el)) hiddenBanners.set(el, {
        value: el.style.display, priority: el.style.getPropertyPriority('display'), url:location.href, reason
      });
      if (el.getAttribute(attr) !== reason) el.setAttribute(attr, reason);
      if (el.style.display !== 'none' || el.style.getPropertyPriority('display') !== 'important')
        el.style.setProperty('display','none','important');
    }
    function restore(el, saved) {
      el.removeAttribute(attr);
      if (el.style.display === 'none') el.style.setProperty('display',saved.value,saved.priority);
      hiddenBanners.delete(el);
    }
    const excluded = protectedAreas + ',nav,header,form,[role="toolbar"],[role="alert"],[role="status"],[role="dialog"],[role="menu"]';
    // The portal's anti-adblock notice has a random ID in both light and dark themes.
    // Match its own controls, exact captions and fixed bottom placement; never a mail body.
    function isAdblockPrompt(el) {
      if (!el?.matches('div:has(> .iconWrapper > .icon):has(> .closeWrapper > .close)') ||
          el.closest(protectedAreas + ',nav,header,form,dialog,[role="toolbar"],[role="dialog"],[role="menu"]') ||
          el.querySelector(excluded + ',input,textarea')) return false;
      const title = el.querySelector(':scope > div > .title');
      const help = el.querySelector(':scope > .buttonWrapper > .button-help');
      if (title?.textContent.trim() !== 'Кажется, возникла проблема из-за блокировщика рекламы' ||
          help?.textContent.trim() !== 'Добавить в исключения') return false;
      const style = getComputedStyle(el);
      return style.position === 'fixed' && style.bottom !== 'auto';
    }
    function horizontalCard(start, row, manual = false) {
      const anchor = row?.getBoundingClientRect();
      let best = null;
      for (let el = start; el && el !== document.body; el = el.parentElement) {
        const box = el.getBoundingClientRect();
        if ((row && el.contains(row)) || box.height > 240 || el.closest(excluded) ||
            el.querySelector(excluded + ',input,textarea')) break;
        if (box.height < 40 || box.width < 240 || box.width < box.height * 2.5) continue;
        if (anchor && (box.bottom > anchor.top + 3 || anchor.top - box.bottom > 64 ||
            anchor.left < box.left - 16 || anchor.left > box.right)) continue;
        const knownSurface = el.matches('iframe,canvas') || el.shadowRoot || el.querySelector('iframe,canvas');
        // A closed component can present no accessible children at all. Require alignment
        // with the first action, plus an otherwise empty, card-sized block.
        const opaque = anchor && box.width >= 340 && anchor.left - box.left < 130 &&
          !el.textContent.trim() && !el.childElementCount;
        // The click picker in 1.7 could select the plain HTML variant. Automatically
        // recognize it from a left-aligned wide strip with artwork or a commercial CTA.
        const cardUI = anchor && box.width >= 340 && anchor.left - box.left < 130 &&
          (el.querySelector('img,picture') || [...el.querySelectorAll('button,a,[role="button"]')]
            .some(control => /^(Играть|Подробнее|Узнать|Выбрать|Перейти|Открыть сайт|Попробовать)$/i.test(control.textContent.trim())));
        if (manual || knownSurface || opaque || cardUI) best = el;
      }
      return best;
    }
    function caption(el) {
      return [el.getAttribute('aria-label'), el.title, el.textContent?.trim()].filter(Boolean);
    }
    function toolbarAction() {
      for (const el of document.querySelectorAll(menu)) {
        if (!el.closest(protectedAreas) && el.getBoundingClientRect().height > 0) return el;
      }
      const controls = [...document.querySelectorAll('button,a,[role="button"],[title],[aria-label],span,div:not(:has(> *))')];
      const actions = controls.filter(el => !el.closest(protectedAreas) &&
        caption(el).some(s => /^(Удалить|В архив|Ответить|Переслать)(?: письмо)?$/i.test(s)) &&
        el.getBoundingClientRect().height > 0);
      return actions.find(el => actions.some(other => other !== el &&
        caption(other)[0] !== caption(el)[0] &&
        Math.abs(other.getBoundingClientRect().top - el.getBoundingClientRect().top) < 18));
    }
    function adLabel(el) {
      const roots = [el];
      if (el.shadowRoot) roots.push(el.shadowRoot);
      for (const host of el.querySelectorAll('*')) if (host.shadowRoot) roots.push(host.shadowRoot);
      return roots.some(root => marker.test(root.textContent) ||
        [...root.querySelectorAll('[aria-label],[title],img[alt]')].some(item =>
          [item.getAttribute('aria-label'),item.title,item.getAttribute('alt')].some(s => s && marker.test(s))));
    }
    // Sample only the top of the reading pane. This also finds a label inside an open
    // shadow root without walking the message tree or relying on translated toolbar text.
    function labelledTopCard(row) {
      const header = document.querySelector('#headline')?.getBoundingClientRect();
      const cssTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--headline-height'));
      const top = header?.height > 0 ? header.bottom : (cssTop || 62);
      const boundary = row?.getBoundingClientRect().top;
      for (const x of [.50,.75,.91].map(f => Math.floor(innerWidth*f))) {
        for (const offset of [24,58,86]) {
          let best;
          for (let el = document.elementFromPoint(x,top + offset); el && el !== document.body; el = el.parentElement) {
            const box = el.getBoundingClientRect();
            if (box.height > 210 || el.closest(excluded) || (row && el.contains(row))) break;
            if (box.top < top - 6 || box.top > top + 36 || box.height < 40 ||
                box.width < Math.max(270,innerWidth*.35) || box.width < box.height*2.5 ||
                (boundary != null && box.bottom > boundary+3)) continue;
            if (el.querySelector(excluded + ',input,textarea')) break;
            if (best || adLabel(el)) best = el;
          }
          if (best) return best;
        }
      }
    }
    function update() {
      if (!document.body) return;
      if (performance.now() >= nextSheetCheck) {
        refreshSlotNames();
        nextSheetCheck = performance.now() + 2500;
      }
      const reading = readingLetter();
      const row = reading ? toolbarAction() : null;
      const boundary = row?.getBoundingClientRect().top;
      for (const [el,saved] of hiddenBanners) {
        if (!el.isConnected || saved.url !== location.href ||
            (saved.reason === 'adblock-prompt' ? !isAdblockPrompt(el) : el.querySelector(protectedAreas) ||
            el.closest(excluded) || el.querySelector(excluded + ',input,textarea') ||
            (saved.reason === 'native' && !el.matches(detectedSlots)) ||
            (row && el.contains(row)) || (saved.reason === 'label' && !marker.test(el.textContent)) ||
            (saved.reason === 'top-label' && !adLabel(el)))) restore(el,saved);
        else hide(el,saved.reason);
      }
      for (const help of document.querySelectorAll('.buttonWrapper > .button-help')) {
        const prompt = help.parentElement.parentElement;
        if (isAdblockPrompt(prompt)) hide(prompt,'adblock-prompt');
      }
      // Outrank a late inline display:... !important on a known slot. Keep this
      // separate from toolbar recognition: toolbar text can load after the ad.
      for (const el of document.querySelectorAll(detectedSlots)) {
        if (getComputedStyle(el).display !== 'none') hide(el,'native');
      }
      if (reading) {
        const card = labelledTopCard(row);
        if (card) hide(card,'top-label');
      }
      if (!row) return;
      // Some creatives are rendered inside a frame or a separate component.
      // Only consider a wide, shallow surface immediately above this action row on an open letter.
      const x = row.getBoundingClientRect().left + 30;
      for (const dy of [32,60,90]) {
        const card = horizontalCard(document.elementFromPoint(x,boundary-dy),row);
        if (card) { hide(card,'surface'); break; }
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
        acceptNode(el) {
          if (el.matches(protectedAreas + ',script,style,textarea,[' + attr + ']')) return NodeFilter.FILTER_REJECT;
          if (el.childElementCount > 3 || el.textContent.length > 120) return NodeFilter.FILTER_SKIP;
          return marker.test(el.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      });
      for (let label; (label = walker.nextNode());) {
        let best = null;
        for (let el = label; el && el !== document.body; el = el.parentElement) {
          const r = el.getBoundingClientRect();
          if (el.contains(row) || el.querySelector(protectedAreas) || r.bottom > boundary + 3 || r.height > 260) break;
          if (r.height >= 40 && r.width >= 220 && r.width >= 2 * r.height &&
              el.querySelector('img, picture, button, a, [role="button"]')) best = el;
        }
        if (best && !best.closest(excluded) && !best.querySelector(excluded)) hide(best,'label');
      }
    }
    let timer;
    function schedule() {
      if (timer) return;
      timer = requestAnimationFrame(() => { timer = 0; update(); });
    }
    const styles = 'style,link[rel="stylesheet"]';
    new MutationObserver(records => {
      for (const record of records) {
        const owner = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
        if (owner?.matches?.(styles)) {
          if (owner.sheet) inspected.delete(owner.sheet);
          nextSheetCheck = 0;
        } else if ([...record.addedNodes,...record.removedNodes].some(el => el.matches?.(styles))) nextSheetCheck = 0;
      }
      schedule();
    }).observe(document, {subtree:true, childList:true, characterData:true,
      attributes:true, attributeFilter:['class','style','aria-label','title','data-qa-id','data-qa-is-topline','data-qa-placement-name']});
    window.addEventListener('pageshow',schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('load', schedule, true);
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Скрыть баннер над письмом', () => {
      if (!readingLetter() || !document.body) return;
      let overlay = document.getElementById('mailru-pick-top');
      if (overlay) return;
      overlay = document.createElement('div'); overlay.id = 'mailru-pick-top';
      overlay.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483647!important;cursor:crosshair!important;';
      const tip = document.createElement('span');
      tip.textContent = 'Щёлкните по баннеру над письмом · Esc — отмена';
      tip.style.cssText = 'position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:#17233a;color:#fff;padding:10px 15px;border-radius:8px;font:15px system-ui;';
      overlay.append(tip); document.body.append(overlay);
      function close() { overlay.remove(); window.removeEventListener('keydown',escape,true); }
      function escape(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
      window.addEventListener('keydown',escape,true);
      overlay.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation(); close();
        const card = horizontalCard(document.elementFromPoint(e.clientX,e.clientY),toolbarAction(),true);
        if (card) hide(card,'picked');
        else window.alert('Не удалось выделить отдельную полосу баннера.');
      },true);
    });
    // Frame interiors and closed shadow roots may update without a mutation in the surrounding document.
    const retry = setInterval(() => { if (!document.hidden) schedule(); }, 2500);
    window.addEventListener('pagehide', e => { if (!e.persisted) clearInterval(retry); }, {once:true});
    schedule();
    return;
  }
  if (location.pathname === '/') {
    const hidden = new Map();
    let scheduled = false, status = '', panel;
    // Keep a small local alternative for any control omitted by this portal layout.
    // Its links open Mail normally, including its login page when necessary.
    function getPanel() {
      if (panel?.isConnected) return panel;
      panel = document.createElement('section');
      panel.id = 'mailru-clean-home-tools';
      const shadow = panel.attachShadow({mode:'open'});
      const style = document.createElement('style');
      style.textContent = ':host{display:block;margin:16px auto;padding:0 18px;max-width:900px;font:16px system-ui;color:#222}nav,form{display:flex;gap:14px;align-items:center;margin:10px 0}a{color:#075bd8}input{flex:1;min-width:0;border:1px solid #aab5c2;border-radius:8px;padding:10px}button{background:#0766ec;color:white;border:0;border-radius:8px;padding:10px 18px;font:inherit;cursor:pointer}[hidden]{display:none!important}';
      shadow.append(style);
      const nav = document.createElement('nav');
      for (const [label, url] of [['Входящие','https://e.mail.ru/inbox/'],['Написать письмо','https://e.mail.ru/compose/']]) {
        const link = document.createElement('a');
        link.textContent = label; link.href = url; nav.append(link);
      }
      const form = document.createElement('form');
      form.action = 'https://yandex.ru/search/'; form.method = 'get';
      const input = document.createElement('input');
      input.name = 'text'; input.type = 'search'; input.placeholder = 'Поиск Яндекса';
      input.setAttribute('aria-label',input.placeholder);
      const button = document.createElement('button'); button.textContent = 'Найти';
      form.append(input,button); shadow.append(nav,form);
      document.body.append(panel);
      return panel;
    }
    function refreshHome() {
      scheduled = false;
      const root = document.body;
      const next = new Set();
      if (root) {
        const header = root.querySelector('.grid__header,#app_head,#ph-whiteline,header,[role="banner"]');
        const field = root.querySelector('input[placeholder*="Поиск"],input[type="search"],input[name="q"],input[name="text"]');
        let search = root.querySelector('.search-frame,form#search') || field?.closest('form,[role="search"]');
        let mail = root.querySelector('#mailbox,.mailbox-container,[class*="Mailbox_mailbox__"]');
        // A signed-in account can have different class names. Find the smallest box containing both actions.
        if (!mail) {
          const actions = [...root.querySelectorAll('a,button,[role="link"]')].filter(el => !header?.contains(el));
          const inbox = actions.find(el => /^Входящие(?:\s|\d|$)/i.test(el.textContent.trim()));
          const compose = actions.find(el => /^Написать письмо$/i.test(el.textContent.trim()));
          if (inbox && compose) {
            mail = inbox.parentElement;
            while (mail && !mail.contains(compose)) mail = mail.parentElement;
            // Keep the account panel, including its avatar and account switcher.
            mail = mail?.closest('article, [class*="mailbox" i], [class*="widget" i]') || mail;
          }
        }
        if (mail === root || mail?.contains(header) || mail?.contains(search)) mail = null;
        if (search?.contains(header) || search?.contains(mail)) search = null;
        const fallback = (!mail || !search) ? getPanel() : null;
        if (!fallback && panel?.isConnected) panel.remove();
        if (fallback) {
          fallback.shadowRoot.querySelector('nav').hidden = !!mail;
          fallback.shadowRoot.querySelector('form').hidden = !!search;
        }
        status = 'Карточка почты: ' + (mail ? 'с сайта' : 'прямые ссылки') +
          '. Поиск: ' + (search ? 'с сайта' : 'встроенная строка') + '.';
        const paths = new Map();
        const overlays = [...root.querySelectorAll('dialog[open],[role="dialog"],[role="menu"],[aria-modal="true"]')]
          .filter(el => el.getClientRects().length && getComputedStyle(el).visibility === 'visible');
        for (const anchor of [header, mail, search, fallback, ...overlays].filter(Boolean)) {
            for (let el = anchor; el && el !== root; el = el.parentElement) {
              const parent = el.parentElement;
              if (!paths.has(parent)) paths.set(parent, new Set());
              paths.get(parent).add(el);
            }
        }
        for (const [parent, keep] of paths) {
          for (const child of parent.children) {
            if (!keep.has(child) && !child.matches('style,link,script,template,dialog,[role="dialog"],[role="menu"],[aria-modal="true"]')) next.add(child);
          }
        }
      }
      for (const [el, prev] of hidden) {
        if (next.has(el)) continue;
        if (el.style.display === 'none') el.style.setProperty('display', prev.value, prev.priority);
        hidden.delete(el);
      }
      for (const el of next) {
        if (!hidden.has(el)) hidden.set(el, {value:el.style.display, priority:el.style.getPropertyPriority('display')});
        if (el.style.display !== 'none' || el.style.getPropertyPriority('display') !== 'important') el.style.setProperty('display','none','important');
      }
    }
    function scheduleHome() {
      if (!scheduled) { scheduled = true; requestAnimationFrame(refreshHome); }
    }
    new MutationObserver(scheduleHome).observe(document, {subtree:true,childList:true,attributes:true,attributeFilter:['class','id','slot','style','role','open']});
    scheduleHome();
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Проверить очистку главной', () =>
      window.alert('Mail.ru · версия 1.9.1\n' + status + ' Скрытых блоков: ' + hidden.size));
    return;
  }
  const slots = [
    '[data-logger="partnerNews"]', '[class*="rb-slot_plug"]', '.box_double',
    '[slot="main-column"] > .stripe-wrapper', '[slot="main-column"] > article[class]:empty',
    '[data-ad-slot]', 'ins.adsbygoogle', 'iframe[src^="https://ad.mail.ru/"]',
    '[data-mailru-local-ad]'
  ];
  const css = slots.join(',\n') + ' { display: none !important; }';
  const cards = 'article, [role="listitem"], [slot="main-column"] > div';
  const badge = /^(?:реклама(?:\s*[·|•]\s*\d+\+)?|на правах рекламы|партн[её]рский материал|advertisement|sponsored)$/i;
  const seen = new WeakSet();
  const pending = new Set();
  let scheduled = false;

  function inspectCard(card) {
    const hasMarker = el => badge.test((el.getAttribute('aria-label') || '').trim()) ||
      (!el.childElementCount && badge.test((el.textContent || '').trim()));
    const isAd = !card.querySelector('article, [role="listitem"], nav, form, [contenteditable="true"]') &&
      (card.querySelector('a[href*="?erid=" i], a[href*="&erid=" i], a[href^="https://ad.mail.ru/"]') ||
       (card.parentElement?.matches('[slot="main-column"]') &&
        getComputedStyle(card).transitionProperty === 'box-shadow') ||
       hasMarker(card) || Array.from(card.querySelectorAll('*')).some(hasMarker));
    card.toggleAttribute('data-mailru-local-ad', Boolean(isAd));
  }

  function enqueue(node) {
    if (!node || pending.has(node)) return;
    pending.add(node);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const batch = new Set(pending);
      pending.clear();
      for (const root of batch) {
        if (root instanceof Element && !root.isConnected) continue;
        let parent = root.parentNode;
        while (parent && !batch.has(parent)) parent = parent.parentNode;
        if (parent) continue;
        const affected = new Set(root.querySelectorAll(cards));
        if (root instanceof Element && root.closest(cards)) affected.add(root.closest(cards));
        for (const card of affected) inspectCard(card);
        if (root.shadowRoot) watch(root.shadowRoot);
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) watch(el.shadowRoot);
      }
    });
  }

  function watch(root) {
    if (seen.has(root)) return;
    seen.add(root);
    if (root instanceof ShadowRoot) {
      const style = document.createElement('style');
      style.textContent = css;
      root.append(style);
    }
    new MutationObserver(records => {
      for (const r of records) {
        if (r.type === 'attributes') enqueue(r.target);
        else if (r.type === 'characterData') enqueue(r.target.parentElement);
        else {
          if (r.removedNodes.length) enqueue(r.target);
          for (const node of r.addedNodes) enqueue(node.nodeType === 1 ? node : node.parentElement);
        }
      }
    }).observe(root, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['aria-label', 'href', 'slot', 'class'] });
    enqueue(root);
  }
  GM_addStyle(css);
  watch(document);
  window.addEventListener('load', () => enqueue(document), { once: true });
})();
