/*
 * GeckoCord mobile layout.
 *
 * Reshapes Discord's desktop web client into the navigation model of the
 * official phone app:
 *   - "list" screen: server rail + channel list, with a bottom tab bar
 *   - "chat" screen: full-width chat that slides over the list
 *   - drag the chat right (or press Back / the header arrow) to return
 *   - swipe left in chat for the member list
 *   - context menus, profiles and pickers open as bottom sheets
 *   - user settings become a list screen and a page screen
 *
 * Discord's class names are hashed, so panes are found structurally and tagged
 * with data-gc-* attributes that mobile.css styles.
 */
(() => {
  "use strict";

  const MOBILE_MAX_WIDTH = 900;
  const LOCK = 12; // px before a touch is classified as a horizontal drag
  const COMMIT = 0.3; // fraction of screen width that commits a drag
  const RAIL_WIDTH = 72;

  const root = document.documentElement;

  const svg = (d) =>
    `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    back: svg('<path d="M20 12H4.5"/><path d="M10.5 5.5 4 12l6.5 6.5"/>'),
    home: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.2V20h4.5v-5.5h3V20H18V9.2"/>'),
    messages: svg(
      '<path d="M5 4.5h14A1.5 1.5 0 0 1 20.5 6v9.5A1.5 1.5 0 0 1 19 17h-7.5L7 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5Z"/>'
    ),
    notifications: svg('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z"/><path d="M10 20.5a2.1 2.1 0 0 0 4 0"/>'),
    you: svg('<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  };
  const TABS = [
    ["home", "Home"],
    ["messages", "Messages"],
    ["notifications", "Notifications"],
    ["you", "You"],
  ];

  const MEMBERS = '[class*="membersWrap_"], [class*="profilePanel_"], [class*="userPanelOuter_"]';
  const SHEET_CONTENT =
    '[role="menu"], [class*="userPopout"], [class*="userProfileOuter"], [class*="expressionPicker"], [id$="picker-tab-panel"]';
  const RAIL = 'nav[class*="guilds_"], [class*="guilds_"], [data-gc-left="rail"]';

  let page = null;
  let port = null;
  let backBtn = null;
  let tabs = null;
  let lastPath = "";
  let lastGuild = null;
  let railTouchAt = 0;
  let passthrough = false;
  let swallowClick = false;
  let lastBars = "";
  let barsTimer = 0;

  const isMobile = () => root.hasAttribute("data-gc-mobile");
  const view = () => root.getAttribute("data-gc-view");
  const membersOpen = () => root.hasAttribute("data-gc-members");
  const settingsMode = () => root.getAttribute("data-gc-settings");
  const hasClass = (el, prefix) =>
    !!el && new RegExp("(^|\\s)" + prefix).test(el.getAttribute("class") || "");

  /** Click a Discord element without our own capture handler interfering. */
  function press(el) {
    if (!el) return false;
    passthrough = true;
    try {
      el.click();
    } finally {
      passthrough = false;
    }
    return true;
  }

  const clickable = (el) => (el ? el.closest('button, [role="button"], a') || el : null);

  // ---------- viewport ----------

  function ensureViewport() {
    const content =
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content";
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      (document.head || root).appendChild(meta);
    }
    if (meta.content !== content) meta.content = content;
  }

  function updateMobile() {
    root.toggleAttribute("data-gc-mobile", window.innerWidth <= MOBILE_MAX_WIDTH);
    layoutChrome();
    reportBarsSoon();
  }

  // ---------- state ----------

  function setView(next) {
    if (view() === next) return;
    root.setAttribute("data-gc-view", next);
    if (next !== "chat") setMembers(false);
    updateTabs();
    layoutChrome();
    reportBarsSoon();
  }

  function membersToggle() {
    if (!page) return null;
    return clickable(page.querySelector('[class*="toolbar_"] [aria-label*="member" i]'));
  }

  function setMembers(open) {
    if (open && page && !page.querySelector(MEMBERS)) press(membersToggle());
    root.toggleAttribute("data-gc-members", open);
  }

  function setSettings(mode) {
    if (mode) root.setAttribute("data-gc-settings", mode);
    else root.removeAttribute("data-gc-settings");
    layoutChrome();
    reportBarsSoon();
  }

  const dialogOpen = () =>
    !!document.querySelector('[class*="layerContainer_"] [role="dialog"], [class*="layerContainer_"] [role="menu"]');
  const settingsView = () => document.querySelector('[class*="standardSidebarView_"]');

  // ---------- layout tagging ----------

  function findPage() {
    for (const el of document.querySelectorAll('[class*="page_"]')) {
      const parent = el.parentElement;
      if (hasClass(parent, "content_") && hasClass(parent.parentElement, "base_")) return el;
    }
    return null;
  }

  function tag() {
    const found = findPage();
    if (!found) return;
    if (page && page !== found) page.removeAttribute("data-gc-page");
    page = found;
    page.setAttribute("data-gc-page", "");

    const shell = page.parentElement;
    shell.setAttribute("data-gc-shell", "");
    for (const child of shell.children) {
      if (child === page) continue;
      const rail = child.tagName === "NAV" || hasClass(child, "guilds_");
      child.setAttribute("data-gc-left", rail ? "rail" : "fill");
    }

    // Desktop title bar (refreshed UI) and notice banners sit beside the shell.
    const base = shell.parentElement;
    base.setAttribute("data-gc-base", "");
    for (const child of base.children) {
      if (child !== shell) child.setAttribute("data-gc-titlebar", "");
    }

    if (!view()) setView("list");
  }

  function syncSheets() {
    for (const layer of document.querySelectorAll('[class*="layerContainer_"] > [class*="layer_"]')) {
      layer.toggleAttribute("data-gc-sheet", !!layer.querySelector(SHEET_CONTENT));
    }
  }

  function syncSettings() {
    const open = !!settingsView();
    if (open && !settingsMode()) setSettings("list");
    else if (!open && settingsMode()) setSettings(null);
  }

  function syncRoute() {
    const path = location.pathname;
    if (path === lastPath) return;
    const prev = lastPath;
    lastPath = path;

    const guild = path.match(/^\/channels\/(\d+)(\/|$)/);
    if (guild) lastGuild = guild[1];
    root.removeAttribute("data-gc-members");

    // Navigation that didn't come from the server rail (a channel tap, a
    // notification, a jump link) lands on the chat screen.
    const isChannel = /^\/channels\/(@me|\d+)\/\d+/.test(path);
    if (prev && isChannel && view() === "list" && Date.now() - railTouchAt > 1500) {
      setView("chat");
    }
    updateTabs();
  }

  function syncAvatar() {
    if (!tabs) return;
    const img = document.querySelector('[class*="panels_"] [class*="avatarWrapper_"] img');
    const slot = tabs.querySelector('[data-tab="you"] .gc-icon');
    if (!img || !img.src || slot.dataset.src === img.src) return;
    slot.dataset.src = img.src;
    const own = document.createElement("img");
    own.src = img.src;
    own.alt = "";
    slot.replaceChildren(own);
  }

  function tick() {
    if (!page || !page.isConnected || !page.hasAttribute("data-gc-page")) tag();
    root.toggleAttribute("data-gc-layered", dialogOpen());
    syncSheets();
    syncSettings();
    syncRoute();
    syncAvatar();
    layoutChrome();
    reportBarsSoon();
  }

  let scheduled = false;
  function scheduleTick() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      tick();
    });
  }

  // ---------- our chrome: back arrow + tab bar ----------

  function ensureChrome() {
    if (!document.body) return;
    if (!backBtn) {
      backBtn = document.createElement("button");
      backBtn.id = "gc-back";
      backBtn.type = "button";
      backBtn.setAttribute("aria-label", "Back");
      backBtn.innerHTML = ICONS.back;
      backBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleBack();
      });
      document.body.appendChild(backBtn);
    }
    if (!tabs) {
      tabs = document.createElement("nav");
      tabs.id = "gc-tabs";
      tabs.setAttribute("aria-label", "Main");
      tabs.innerHTML = TABS.map(
        ([key, label]) =>
          `<button type="button" data-tab="${key}"><span class="gc-icon">${ICONS[key]}</span><span class="gc-label">${label}</span></button>`
      ).join("");
      tabs.addEventListener("click", onTab);
      document.body.appendChild(tabs);
      updateTabs();
    }
  }

  function layoutChrome() {
    ensureChrome();
    if (!backBtn) return;
    let top = null;
    if (settingsMode()) {
      top = 8;
    } else if (view() === "chat" && page && !root.hasAttribute("data-gc-layered")) {
      const header = page.querySelector('section[class*="title_"], [class*="upperContainer_"]');
      const r = (header || page).getBoundingClientRect();
      top = r.top + ((header ? r.height : 48) - 40) / 2;
    }
    root.toggleAttribute("data-gc-back", top !== null);
    if (top !== null) backBtn.style.top = Math.max(0, Math.round(top)) + "px";
  }

  function updateTabs() {
    if (!tabs) return;
    const active = location.pathname.startsWith("/channels/@me") ? "messages" : "home";
    for (const b of tabs.querySelectorAll("button[data-tab]")) {
      if (b.dataset.tab === active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
  }

  const railItem = (id) => document.querySelector(`[data-list-item-id="guildsnav___${id}"]`);

  function firstGuild() {
    for (const el of document.querySelectorAll('[data-list-item-id^="guildsnav___"]')) {
      if (/guildsnav___\d+$/.test(el.getAttribute("data-list-item-id"))) return el;
    }
    return null;
  }

  function inboxButton() {
    return clickable(document.querySelector('[aria-label="Inbox"], [class*="recentsIcon_"]'));
  }

  function settingsButton() {
    const labelled = document.querySelector('[class*="panels_"] [aria-label="User Settings"]');
    if (labelled) return clickable(labelled);
    const avatar = document.querySelector('[class*="panels_"] [class*="avatarWrapper_"]');
    const section = avatar && (avatar.closest("section") || avatar.parentElement);
    const buttons = section ? section.querySelectorAll('button, [role="button"]') : [];
    return buttons[buttons.length - 1] || null;
  }

  function onTab(e) {
    const b = e.target instanceof Element && e.target.closest("button[data-tab]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    railTouchAt = Date.now();
    switch (b.dataset.tab) {
      case "home": {
        if (location.pathname.startsWith("/channels/@me") || !/^\/channels\/\d+/.test(location.pathname)) {
          press((lastGuild && railItem(lastGuild)) || firstGuild());
        }
        setView("list");
        break;
      }
      case "messages":
        if (!location.pathname.startsWith("/channels/@me")) press(railItem("home"));
        setView("list");
        break;
      case "notifications":
        press(inboxButton());
        break;
      case "you":
        press(settingsButton());
        break;
    }
    updateTabs();
  }

  // ---------- taps ----------

  // A tap outside an open bottom sheet only dismisses it; it must not also
  // activate whatever is underneath.
  document.addEventListener(
    "pointerdown",
    (e) => {
      swallowClick = false;
      if (!isMobile() || !(e.target instanceof Element)) return;
      const sheet = document.querySelector("[data-gc-sheet]");
      if (sheet && !sheet.contains(e.target)) swallowClick = true;
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      if (passthrough || !isMobile()) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      if (swallowClick) {
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
        if (document.querySelector("[data-gc-sheet]")) pressEscape();
        return;
      }

      if (target.closest(RAIL)) railTouchAt = Date.now();

      // Discord's member-list button opens our drawer instead of toggling a
      // side column that has no room on a phone.
      const toggle = membersToggle();
      if (toggle && toggle.contains(target)) {
        if (page.querySelector(MEMBERS)) {
          e.preventDefault();
          e.stopPropagation();
          setMembers(!membersOpen());
        } else {
          root.setAttribute("data-gc-members", "");
        }
        return;
      }

      // Tap outside the member drawer closes it.
      if (membersOpen() && page && page.contains(target) && !target.closest(MEMBERS)) {
        e.preventDefault();
        e.stopPropagation();
        setMembers(false);
        return;
      }

      // Picking a channel or DM opens the chat screen (also when it's already
      // the selected one, so the route doesn't change).
      if (view() === "list") {
        const link = target.closest('a[href*="/channels/"]');
        if (link && target.closest("[data-gc-left='fill']") && !link.closest(RAIL)) setView("chat");
      }

      // Picking a settings section opens its page.
      if (settingsMode() === "list" && target.closest('[class*="sidebarRegion_"] [role="tab"]')) {
        setSettings("page");
      }
    },
    true
  );

  // ---------- drag gestures ----------

  let g = null;

  function scrollsX(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
    }
    return false;
  }

  const drag = (px) => root.style.setProperty("--gc-drag", px + "px");

  function pickMode(dx) {
    if (membersOpen()) return dx > 0 ? "closeMembers" : null;
    if (view() === "chat") return dx > 0 ? "back" : "members";
    if (view() === "list" && dx < 0 && g.x > RAIL_WIDTH) return "forward";
    return null;
  }

  document.addEventListener(
    "touchstart",
    (e) => {
      g = null;
      if (!isMobile() || e.touches.length !== 1 || settingsMode() || root.hasAttribute("data-gc-layered")) return;
      if (document.querySelector("[data-gc-sheet]")) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest('textarea, input, [contenteditable="true"], #gc-tabs')) return;
      const t = e.touches[0];
      g = { x: t.clientX, y: t.clientY, time: Date.now(), target, mode: null, dx: 0 };
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!g) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (!g.mode) {
        if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.5 || scrollsX(g.target)) {
          g = null;
          return;
        }
        g.mode = pickMode(dx);
        if (!g.mode) {
          g = null;
          return;
        }
        if (g.mode === "back" || g.mode === "forward") root.setAttribute("data-gc-dragging", "");
      }
      g.dx = dx;
      if (g.mode === "back") drag(Math.max(0, dx));
      else if (g.mode === "forward") drag(Math.min(0, dx));
    },
    { passive: true, capture: true }
  );

  function endGesture(cancelled) {
    if (!g) return;
    const { mode, dx, time } = g;
    g = null;
    if (!mode) return;
    root.removeAttribute("data-gc-dragging");
    drag(0);
    if (cancelled) return;
    const speed = dx / Math.max(1, Date.now() - time);
    const committed = Math.abs(dx) > window.innerWidth * COMMIT || (Math.abs(speed) > 0.45 && Math.abs(dx) > 40);
    if (mode === "back" && dx > 0 && committed) setView("list");
    else if (mode === "forward" && dx < 0 && committed) setView("chat");
    else if (mode === "members" && dx < -60) setMembers(true);
    else if (mode === "closeMembers" && dx > 60) setMembers(false);
  }
  document.addEventListener("touchend", () => endGesture(false), { passive: true, capture: true });
  document.addEventListener("touchcancel", () => endGesture(true), { passive: true, capture: true });

  // ---------- Back (header arrow and Android back button) ----------

  function pressEscape() {
    const target = document.activeElement || document.body;
    for (const type of ["keydown", "keyup"]) {
      target.dispatchEvent(
        new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true })
      );
    }
  }

  function closeSettings() {
    const close = document.querySelector('[class*="toolsContainer_"] [class*="closeButton_"]');
    if (!press(clickable(close))) pressEscape();
  }

  function handleBack() {
    if (document.querySelector("[data-gc-sheet]") || root.hasAttribute("data-gc-layered")) {
      pressEscape();
      return true;
    }
    if (settingsMode() === "page") {
      setSettings("list");
      return true;
    }
    if (settingsMode() === "list") {
      closeSettings();
      return true;
    }
    if (!isMobile()) return false;
    if (membersOpen()) {
      setMembers(false);
      return true;
    }
    if (view() === "chat") {
      setView("list");
      return true;
    }
    return false;
  }

  // ---------- native bridge ----------

  // System bars take the colour of the app edge they touch.
  function colorAt(x, y) {
    for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
      const c = getComputedStyle(el).backgroundColor;
      if (c && c !== "transparent" && !/,\s*0\)$/.test(c)) return c;
    }
    return document.body ? getComputedStyle(document.body).backgroundColor : "";
  }

  function reportBars() {
    if (!port || root.hasAttribute("data-gc-dragging")) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const top = colorAt(w - 4, 1);
    const bottom = colorAt(Math.round(w / 2), h - 1);
    const key = top + "|" + bottom;
    if (key === lastBars) return;
    lastBars = key;
    port.postMessage({ type: "bars", top, bottom });
  }

  function reportBarsSoon() {
    if (barsTimer) return;
    barsTimer = setTimeout(() => {
      barsTimer = 0;
      reportBars();
    }, 280);
  }

  try {
    port = browser.runtime.connectNative("geckocord");
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === "back") {
        port.postMessage({ type: "backResult", id: msg.id, handled: handleBack() });
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
    });
  } catch (err) {
    console.warn("GeckoCord: native messaging unavailable", err);
  }

  // ---------- boot ----------

  updateMobile();
  ensureViewport();
  window.addEventListener("resize", updateMobile);

  new MutationObserver(scheduleTick).observe(root, { childList: true, subtree: true });
  // Theme switches (theme-dark / theme-light on <html>) recolour the bars.
  new MutationObserver(reportBarsSoon).observe(root, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("DOMContentLoaded", () => {
    ensureViewport();
    scheduleTick();
  });
})();
