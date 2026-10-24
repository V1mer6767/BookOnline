"use strict";
/* Читальня — читалка книг з пошуком і офлайн-бібліотекою */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const BUILD = 4;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Іконки ---------- */
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  gear: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  toc: svg('<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  refresh: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>')
};
$("#importBtn").innerHTML = ICON.plus;
$("#refreshBtn").innerHTML = ICON.refresh;
$("#gearBtn").innerHTML = ICON.gear;
$("#rBack").innerHTML = ICON.back;
$("#rToc").innerHTML = ICON.toc;
$("#rAa").innerHTML = '<b style="font-size:17px;font-family:Georgia,serif">Aa</b>';
$$(".closeBtn").forEach(b => (b.innerHTML = ICON.close));
$$(".tab")[0].querySelector("i").innerHTML = ICON.book;
$$(".tab")[1].querySelector("i").innerHTML = ICON.search;
$(".emptyIcon").innerHTML = ICON.book;

/* ---------- Налаштування ---------- */
const DEF = { size: 19, font: "serif", lh: 1.65, mg: 20, theme: "dark", proxy: "" };
let S = { ...DEF };
try { S = { ...DEF, ...JSON.parse(localStorage.getItem("ch_settings") || "{}") }; } catch (e) {}
const saveS = () => { try { localStorage.setItem("ch_settings", JSON.stringify(S)); } catch (e) {} };
const THEME_COLORS = { dark: "#16161a", light: "#f4f3ef", sepia: "#efe3c8" };

function applyTheme() {
  document.body.dataset.theme = S.theme;
  const paper = { dark: "#16161a", light: "#fbfaf7", sepia: "#f4e9cf" }[S.theme];
  $("#themeColor").content = $("#reader").hidden ? THEME_COLORS[S.theme] : paper;
  $$("#themeSeg button, #themeSeg2 button").forEach(b => b.classList.toggle("on", b.dataset.v === S.theme));
}
function applyReadStyle() {
  const r = $("#reader");
  r.style.setProperty("--fs", S.size + "px");
  r.style.setProperty("--lh", S.lh);
  r.style.setProperty("--mg", S.mg + "px");
  $("#rPage").classList.toggle("sans", S.font === "sans");
  $("#fsVal").textContent = S.size;
  $$("#fontSeg button").forEach(b => b.classList.toggle("on", b.dataset.v === S.font));
  $$("#lhSeg button").forEach(b => b.classList.toggle("on", +b.dataset.v === S.lh));
  $$("#mgSeg button").forEach(b => b.classList.toggle("on", +b.dataset.v === S.mg));
}

let toastT;
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), ms);
}

/* ---------- Сховище (IndexedDB) ---------- */
const dbp = new Promise((res, rej) => {
  const r = indexedDB.open("chytalnia_v1", 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("books", { keyPath: "id" });
    r.result.createObjectStore("files");
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function tx(store, mode, fn) {
  const db = await dbp;
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("Сховище переповнене"));
  });
}
const dbAll = () => tx("books", "readonly", s => s.getAll());
const dbPut = b => tx("books", "readwrite", s => s.put(b));
const fileGet = id => tx("files", "readonly", s => s.get(id));
const filePut = (id, rec) => tx("files", "readwrite", s => s.put(rec, id));
async function dbDel(id) {
  await tx("books", "readwrite", s => s.delete(id));
  await tx("files", "readwrite", s => s.delete(id));
}

/* ---------- Мережа ---------- */
const PROXIES = [
  u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  u => "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(u)
];
function proxyList(url) {
  const l = [];
  if (S.proxy) l.push(S.proxy.includes("{url}") ? S.proxy.replace("{url}", encodeURIComponent(url)) : S.proxy + encodeURIComponent(url));
  PROXIES.forEach(f => l.push(f(url)));
  return l;
}
async function readBody(r, onProgress) {
  const total = +r.headers.get("content-length") || 0;
  if (!r.body || !onProgress) {
    const b = await r.arrayBuffer();
    onProgress && onProgress(1, b.byteLength);
    return b;
  }
  const rd = r.body.getReader();
  const parts = []; let got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); got += value.length;
    onProgress(total ? Math.min(got / total, 0.99) : null, got);
  }
  const out = new Uint8Array(got); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}
async function fetchBuf(url, { onProgress, check, direct = true, proxies = true, timeout = 120000 } = {}) {
  const tries = (direct ? [url] : []).concat(proxies ? proxyList(url) : []);
  let last = new Error("Немає з'єднання");
  for (const a of tries) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    try {
      const r = await fetch(a, { signal: c.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const b = await readBody(r, onProgress);
      clearTimeout(t);
      if (check && !check(b)) throw new Error("Сервер повернув не той файл");
      return b;
    } catch (e) { clearTimeout(t); last = e; }
  }
  throw last;
}
async function fetchJSON(url) {
  let parsed;
  await fetchBuf(url, {
    timeout: 30000,
    check: b => { try { parsed = JSON.parse(new TextDecoder().decode(b)); return true; } catch (e) { return false; } }
  });
  return parsed;
}
const isZip = b => { const u = new Uint8Array(b); return u[0] === 0x50 && u[1] === 0x4b; };

/* ---------- Санітізація та допоміжне ---------- */
function sanitize(root) {
  root.querySelectorAll("script,style,link,meta,iframe,object,embed,form,input,button,noscript,audio,video,base,select,textarea").forEach(n => n.remove());
  root.querySelectorAll("*").forEach(el => {
    for (const at of [...el.attributes]) {
      const n = at.name.toLowerCase();
      if (n.startsWith("on") || n === "style" || ((n === "href" || n === "src" || n === "xlink:href") && /^\s*javascript:/i.test(at.value))) el.removeAttribute(at.name);
    }
  });
}
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" };
const mimeOf = p => MIME[(p.split(".").pop() || "").toLowerCase()] || "image/jpeg";
function resolvePath(base, href) {
  const u = new URL((href || "").split("#")[0], "http://h/" + base);
  try { return decodeURIComponent(u.pathname.slice(1)); } catch (e) { return u.pathname.slice(1); }
}
const parseXML = s => {
  const d = new DOMParser().parseFromString(s, "application/xml");
  if (d.querySelector("parsererror")) throw new Error("Пошкоджений XML");
  return d;
};
const q1 = (el, n) => el.getElementsByTagNameNS("*", n)[0];
const qa = (el, n) => [...el.getElementsByTagNameNS("*", n)];
const kids = (el, n) => [...el.children].filter(c => c.localName === n);
const txt = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

/* ---------- Парсери книг ---------- */
// Спільний інтерфейс: { title, author, cover:Blob|null, n, titles[], toc[], html(i), link(path), dispose() }

async function openEpub(buf) {
  const zip = await JSZip.loadAsync(buf);
  const readText = async p => { const f = zip.file(p); return f ? f.async("string") : null; };
  const cont = await readText("META-INF/container.xml");
  if (!cont) throw new Error("Це не EPUB");
  const opfPath = q1(parseXML(cont), "rootfile").getAttribute("full-path");
  const opf = parseXML(await readText(opfPath));

  const manifest = {};
  for (const it of qa(opf, "item")) {
    manifest[it.getAttribute("id")] = {
      path: resolvePath(opfPath, it.getAttribute("href")),
      type: it.getAttribute("media-type") || "",
      props: it.getAttribute("properties") || ""
    };
  }
  const spine = qa(opf, "itemref").map(r => manifest[r.getAttribute("idref")]).filter(m => m && /html/.test(m.type));
  if (!spine.length) throw new Error("У книзі немає тексту");
  const pathToIdx = {};
  spine.forEach((m, i) => (pathToIdx[m.path] = i));

  const title = txt(q1(opf, "title"));
  const author = qa(opf, "creator").map(txt).filter(Boolean).join(", ");

  // обкладинка
  let coverPath = null;
  const cm = qa(opf, "meta").find(m => m.getAttribute("name") === "cover");
  if (cm && manifest[cm.getAttribute("content")]) coverPath = manifest[cm.getAttribute("content")].path;
  if (!coverPath) { const ci = Object.values(manifest).find(m => /cover-image/.test(m.props)); if (ci) coverPath = ci.path; }
  if (!coverPath) { const e = Object.entries(manifest).find(([id, m]) => /cover/i.test(id) && /^image\//.test(m.type)); if (e) coverPath = e[1].path; }
  let cover = null;
  if (coverPath && zip.file(coverPath)) cover = new Blob([await zip.file(coverPath).async("arraybuffer")], { type: mimeOf(coverPath) });

  // зміст
  const toc = [];
  try {
    const navItem = Object.values(manifest).find(m => /\bnav\b/.test(m.props));
    const ncxItem = Object.values(manifest).find(m => m.type === "application/x-dtbncx+xml");
    if (navItem) {
      const d = new DOMParser().parseFromString(await readText(navItem.path), "text/html");
      const nav = d.querySelector('nav[epub\\:type~="toc"]') || d.querySelector("nav");
      if (nav) nav.querySelectorAll("a[href]").forEach(a => {
        let lvl = 0, p = a.parentElement;
        while (p && p !== nav) { if (p.tagName === "OL" || p.tagName === "UL") lvl++; p = p.parentElement; }
        const path = resolvePath(navItem.path, a.getAttribute("href"));
        toc.push({ title: a.textContent.replace(/\s+/g, " ").trim(), path, id: (a.getAttribute("href").split("#")[1] || ""), lvl: Math.max(0, lvl - 1) });
      });
    }
    if (!toc.length && ncxItem) {
      const d = parseXML(await readText(ncxItem.path));
      qa(d, "navPoint").forEach(np => {
        let lvl = 0, p = np.parentElement;
        while (p) { if (p.localName === "navPoint") lvl++; p = p.parentElement; }
        const c = kids(np, "content")[0]; if (!c) return;
        const src = c.getAttribute("src") || "";
        toc.push({ title: txt(q1(np, "navLabel")), path: resolvePath(ncxItem.path, src), id: src.split("#")[1] || "", lvl });
      });
    }
  } catch (e) {}
  const tocOut = toc.map(t => ({ ...t, ch: pathToIdx[t.path] })).filter(t => t.ch !== undefined && t.title);

  const titles = spine.map((_, i) => {
    const t = tocOut.filter(x => x.ch === i)[0];
    return t ? t.title : "Розділ " + (i + 1);
  });

  const urls = {};
  const blobUrl = async path => {
    if (urls[path]) return urls[path];
    const f = zip.file(path); if (!f) return null;
    const b = new Blob([await f.async("arraybuffer")], { type: mimeOf(path) });
    return (urls[path] = URL.createObjectURL(b));
  };

  return {
    title, author, cover, n: spine.length, titles, toc: tocOut,
    link: path => (pathToIdx[path] !== undefined ? pathToIdx[path] : -1),
    async html(i) {
      const m = spine[i];
      const doc = new DOMParser().parseFromString((await readText(m.path)) || "", "text/html");
      const body = doc.body;
      sanitize(body);
      for (const im of [...body.querySelectorAll("img")]) {
        const src = im.getAttribute("src") || "";
        if (/^(https?:|data:)/i.test(src)) continue;
        const u = await blobUrl(resolvePath(m.path, src));
        if (u) im.setAttribute("src", u); else im.remove();
      }
      for (const sv of [...body.querySelectorAll("svg")]) {
        const image = sv.querySelector("image");
        const href = image && (image.getAttribute("href") || image.getAttribute("xlink:href"));
        const u = href && (await blobUrl(resolvePath(m.path, href)));
        if (u) { const img = doc.createElement("img"); img.src = u; sv.replaceWith(img); } else sv.remove();
      }
      body.querySelectorAll("a[href]").forEach(a => {
        const h = a.getAttribute("href");
        if (/^[a-z][a-z0-9+.-]*:/i.test(h)) { a.target = "_blank"; a.rel = "noopener"; return; }
        const [p, id] = h.split("#");
        a.dataset.path = p ? resolvePath(m.path, p) : m.path;
        if (id) a.dataset.id = id;
        a.removeAttribute("href");
      });
      return body.innerHTML;
    },
    dispose() { Object.values(urls).forEach(u => URL.revokeObjectURL(u)); }
  };
}

async function openFb2(buf) {
  if (isZip(buf)) {
    const z = await JSZip.loadAsync(buf);
    const f = Object.values(z.files).find(f => /\.fb2$/i.test(f.name));
    if (!f) throw new Error("В архіві немає FB2");
    buf = await f.async("arraybuffer");
  }
  const head = new TextDecoder("latin1").decode(new Uint8Array(buf).slice(0, 300));
  const enc = (head.match(/encoding=["']([\w-]+)["']/i) || [])[1] || "utf-8";
  let xml;
  try { xml = new TextDecoder(enc).decode(buf); } catch (e) { xml = new TextDecoder().decode(buf); }
  const doc = parseXML(xml.replace(/^﻿/, ""));
  const root = doc.documentElement;
  const hrefOf = e => { const a = [...e.attributes].find(a => a.localName === "href"); return a ? a.value.replace(/^#/, "") : ""; };

  const bins = {};
  for (const b of qa(doc, "binary")) bins[b.getAttribute("id")] = { type: b.getAttribute("content-type") || "image/jpeg", data: b.textContent.replace(/\s+/g, "") };
  const binBlob = id => {
    const b = bins[id]; if (!b) return null;
    if (!b.blob) {
      const s = atob(b.data), arr = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
      b.blob = new Blob([arr], { type: b.type });
    }
    return b.blob;
  };
  const urls = {};
  const binUrl = id => { const b = binBlob(id); return b ? (urls[id] = urls[id] || URL.createObjectURL(b)) : null; };

  const ti = q1(doc, "title-info");
  const title = ti ? txt(q1(ti, "book-title")) : "";
  const author = ti ? qa(ti, "author").slice(0, 3).map(a => ["first-name", "middle-name", "last-name"].map(n => txt(q1(a, n))).filter(Boolean).join(" ")).filter(Boolean).join(", ") : "";
  let cover = null;
  const cp = ti && q1(ti, "coverpage");
  if (cp && q1(cp, "image")) cover = binBlob(hrefOf(q1(cp, "image")));

  const bodies = kids(root, "body");
  const notes = {};
  bodies.filter(b => b.getAttribute("name") === "notes").forEach(nb => qa(nb, "section").forEach(s => { notes[s.getAttribute("id")] = txt(s).slice(0, 500); }));
  const main = bodies.find(b => b.getAttribute("name") !== "notes") || bodies[0];
  if (!main) throw new Error("У файлі немає тексту");

  const f2h = node => {
    let out = "";
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += esc(c.nodeValue);
      else if (c.nodeType === 1) out += el2h(c);
    }
    return out;
  };
  const el2h = e => {
    const inner = () => f2h(e);
    switch (e.localName) {
      case "p": return `<p>${inner()}</p>`;
      case "title": return `<h2>${kids(e, "p").map(p => f2h(p)).join("<br>") || inner()}</h2>`;
      case "subtitle": return `<h3>${inner()}</h3>`;
      case "emphasis": return `<em>${inner()}</em>`;
      case "strong": return `<strong>${inner()}</strong>`;
      case "strikethrough": return `<s>${inner()}</s>`;
      case "sub": return `<sub>${inner()}</sub>`;
      case "sup": return `<sup>${inner()}</sup>`;
      case "code": return `<code>${inner()}</code>`;
      case "empty-line": return "<br>";
      case "epigraph": case "cite": return `<blockquote>${inner()}</blockquote>`;
      case "text-author": return `<p class="author">${inner()}</p>`;
      case "poem": return `<div class="poem">${inner()}</div>`;
      case "stanza": return `<div class="stanza">${inner()}</div>`;
      case "v": return `<p class="v">${inner()}</p>`;
      case "image": { const u = binUrl(hrefOf(e)); return u ? `<img src="${u}" alt="">` : ""; }
      case "a":
        if (e.getAttribute("type") === "note") return `<sup class="fnref" data-n="${esc(notes[hrefOf(e)] || "")}">${inner()}</sup>`;
        return inner();
      case "table": case "tr": case "td": case "th": return `<${e.localName}>${inner()}</${e.localName}>`;
      default: return inner();
    }
  };

  const chapters = [];
  const hasText = els => els.some(c => txt(c).length > 0 || c.localName === "image");
  const walk = (sec, parentTitle) => {
    const subs = kids(sec, "section");
    const t = txt(kids(sec, "title")[0]);
    if (!subs.length) { chapters.push({ el: sec, title: t || parentTitle || "", intro: false }); return; }
    const intro = [...sec.children].filter(c => c.localName !== "section");
    if (hasText(intro.filter(c => c.localName !== "title"))) chapters.push({ el: sec, title: t || parentTitle || "", intro: true });
    subs.forEach(s => walk(s, t));
  };
  const subs = kids(main, "section");
  if (!subs.length) chapters.push({ el: main, title: "", intro: false });
  else {
    const intro = [...main.children].filter(c => c.localName !== "section");
    if (hasText(intro.filter(c => c.localName !== "title"))) chapters.push({ el: main, title: txt(kids(main, "title")[0]) || "Початок", intro: true });
    subs.forEach(s => walk(s, ""));
  }
  chapters.forEach((c, i) => { if (!c.title) c.title = "Частина " + (i + 1); });

  return {
    title, author, cover, n: chapters.length,
    titles: chapters.map(c => c.title),
    toc: chapters.map((c, i) => ({ title: c.title, ch: i, id: "", lvl: 0 })),
    link: () => -1,
    async html(i) {
      const c = chapters[i];
      return [...c.el.children].filter(x => !c.intro || x.localName !== "section").map(el2h).join("");
    },
    dispose() { Object.values(urls).forEach(u => URL.revokeObjectURL(u)); }
  };
}

function openTxt(buf, hintTitle) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder("windows-1251").decode(buf); }
  text = text.replace(/^﻿/, "");
  const tm = text.slice(0, 3000).match(/^Title:\s*(.+)$/m), am = text.slice(0, 3000).match(/^Author:\s*(.+)$/m);
  const s = text.indexOf("*** START OF");
  if (s >= 0) text = text.slice(text.indexOf("\n", s) + 1);
  const e = text.indexOf("*** END OF");
  if (e >= 0) text = text.slice(0, e);

  const lines = text.split(/\r?\n/);
  const nonBlank = lines.filter(l => l.trim());
  const blankRatio = 1 - nonBlank.length / Math.max(1, lines.length);
  const avg = nonBlank.reduce((a, l) => a + l.length, 0) / Math.max(1, nonBlank.length);
  let paras = [];
  if (blankRatio > 0.12) {
    const joiner = avg < 50 ? "\n" : " ";
    let cur = [];
    for (const l of lines) {
      if (!l.trim()) { if (cur.length) { paras.push(cur.join(joiner)); cur = []; } } else cur.push(l.trim());
    }
    if (cur.length) paras.push(cur.join(joiner));
  } else paras = nonBlank.map(l => l.trim());

  const HEAD = /^(розділ|частина|глава|книга|пролог|епілог|chapter|part|book|prologue|epilogue)\b|^[IVXLC]+\.?$/i;
  const chapters = [];
  let cur = { title: "", head: false, paras: [], len: 0 };
  const push = () => { if (cur.paras.length) chapters.push(cur); };
  for (const p of paras) {
    const isH = p.length < 70 && HEAD.test(p);
    if ((isH && cur.len > 1500) || cur.len > 30000) {
      push(); cur = { title: isH ? p : "", head: isH, paras: [], len: 0 };
      if (isH) continue;
    }
    cur.paras.push(p); cur.len += p.length;
  }
  push();
  if (!chapters.length) chapters.push({ title: "", head: false, paras: ["(порожній файл)"], len: 0 });
  chapters.forEach((c, i) => { if (!c.title) c.title = "Частина " + (i + 1); });

  return {
    title: (tm && tm[1].trim()) || hintTitle || "", author: (am && am[1].trim()) || "", cover: null,
    n: chapters.length, titles: chapters.map(c => c.title),
    toc: chapters.map((c, i) => ({ title: c.title, ch: i, id: "", lvl: 0 })),
    link: () => -1,
    async html(i) {
      const c = chapters[i];
      return (c.head ? `<h2>${esc(c.title)}</h2>` : "") + c.paras.map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
    },
    dispose() {}
  };
}

function openHtmlBook(buf) {
  const j = JSON.parse(new TextDecoder().decode(buf));
  return {
    title: j.title || "", author: j.author || "", cover: null, n: j.chapters.length,
    titles: j.chapters.map((c, i) => c.title || "Частина " + (i + 1)),
    toc: j.chapters.map((c, i) => ({ title: c.title || "Частина " + (i + 1), ch: i, id: "", lvl: 0 })),
    link: () => -1,
    async html(i) { return j.chapters[i].html; },
    dispose() {}
  };
}

async function parseBook(format, buf, hintTitle) {
  if (format === "epub") return openEpub(buf);
  if (format === "fb2") return openFb2(buf);
  if (format === "html") return openHtmlBook(buf);
  return openTxt(buf, hintTitle);
}

async function detectFormat(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  const u = new Uint8Array(buf.slice(0, 6));
  if (u[0] === 0x50 && u[1] === 0x4b) {
    const z = await JSZip.loadAsync(buf);
    if (z.file("META-INF/container.xml")) return { format: "epub", buf };
    if (Object.values(z.files).some(f => /\.fb2$/i.test(f.name))) return { format: "fb2", buf };
    throw new Error("Невідомий архів");
  }
  const head = new TextDecoder("latin1").decode(u8slice(buf, 400));
  if (name.endsWith(".fb2") || /<FictionBook/i.test(head)) return { format: "fb2", buf };
  return { format: "txt", buf };
}
const u8slice = (buf, n) => new Uint8Array(buf).slice(0, n);

/* ---------- Додавання книги в бібліотеку ---------- */
function shrinkCover(blob) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => {
      const w = Math.min(260, im.naturalWidth || 260), h = Math.round((im.naturalHeight || 390) * w / (im.naturalWidth || 260));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(im, 0, 0, w, h);
      URL.revokeObjectURL(u);
      res(c.toDataURL("image/jpeg", 0.82));
    };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("img")); };
    im.src = u;
  });
}

async function addBook({ buf, format, src, title, author, coverUrl, hint }) {
  const book = await parseBook(format, buf, title || hint);
  let cover = null;
  try {
    let cb = book.cover;
    if (!cb && coverUrl) cb = new Blob([await fetchBuf(coverUrl, { timeout: 8000, proxies: false })]);
    if (cb) cover = await shrinkCover(cb);
  } catch (e) {}
  const meta = {
    id: uid(),
    title: (title || book.title || "Без назви").slice(0, 200),
    author: (author || book.author || "").slice(0, 200),
    format, cover, added: Date.now(), last: 0, pos: { c: 0, f: 0 }, pct: 0,
    src: src || "file:" + uid()
  };
  book.dispose();
  await filePut(meta.id, { buf, format });
  await dbPut(meta);
  await renderLib();
  return meta;
}

/* ---------- Бібліотека ---------- */
let books = [];
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
function genCover(b) {
  const h = hue(b.title);
  return `<div class="cover gen" style="background:linear-gradient(160deg,hsl(${h} 55% 38%),hsl(${(h + 40) % 360} 60% 22%))"><b>${esc(b.title)}</b><small>${esc(b.author)}</small>`;
}
async function renderLib() {
  books = (await dbAll()).sort((a, b) => (b.last || b.added) - (a.last || a.added));
  $("#libEmpty").hidden = books.length > 0;
  $("#libGrid").innerHTML = books.map(b => {
    const bar = b.pct > 0 ? `<div class="bar"><i style="width:${b.pct}%"></i></div>` : "";
    const cover = b.cover ? `<div class="cover"><img src="${b.cover}" alt="">${bar}</div>` : genCover(b) + bar + "</div>";
    return `<button class="card" data-id="${b.id}">${cover}<div class="t">${esc(b.title)}</div><div class="a">${esc(b.author || "—")}</div></button>`;
  }).join("");
  refreshResultButtons();
}

let pressT, pressed = false;
const grid = $("#libGrid");
grid.addEventListener("click", e => {
  if (pressed) { pressed = false; return; }
  const c = e.target.closest(".card"); if (c) openReader(c.dataset.id);
});
grid.addEventListener("pointerdown", e => {
  const c = e.target.closest(".card"); if (!c) return;
  clearTimeout(pressT);
  pressT = setTimeout(() => { pressed = true; bookMenu(c.dataset.id); }, 550);
});
["pointerup", "pointerleave", "pointercancel", "scroll"].forEach(ev => grid.addEventListener(ev, () => clearTimeout(pressT), true));
grid.addEventListener("contextmenu", e => { if (e.target.closest(".card")) e.preventDefault(); });

function bookMenu(id) {
  const b = books.find(x => x.id === id); if (!b) return;
  $("#bmTitle").textContent = b.title;
  $("#bmInfo").textContent = [b.author, b.format.toUpperCase(), b.pct ? "прочитано " + b.pct + "%" : "ще не читав"].filter(Boolean).join(" · ");
  $("#bookMenu").hidden = false;
  $("#bmOpen").onclick = () => { $("#bookMenu").hidden = true; openReader(id); };
  $("#bmDelete").onclick = async () => {
    if (!confirm("Видалити «" + b.title + "»?")) return;
    await dbDel(id); $("#bookMenu").hidden = true; await renderLib(); toast("Книгу видалено");
  };
}

/* ---------- Вкладки ---------- */
const TITLES = { libView: "Бібліотека", searchView: "Пошук книг" };
function showView(id) {
  $$(".view").forEach(v => (v.hidden = v.id !== id));
  $$(".tab").forEach(t => t.classList.toggle("on", t.dataset.view === id));
  $("#viewTitle").textContent = TITLES[id];
  if (id === "searchView" && !browsed) { browsed = true; doSearch(1); }
}
$$(".tab").forEach(t => t.addEventListener("click", () => showView(t.dataset.view)));
$("#emptySearch").onclick = () => showView("searchView");

/* ---------- Імпорт файлів ---------- */
$("#importBtn").onclick = () => $("#fileIn").click();
$("#fileIn").addEventListener("change", async e => {
  const files = [...e.target.files]; e.target.value = "";
  let ok = 0;
  for (const f of files) {
    try {
      toast("Додаю «" + f.name + "»…", 8000);
      const { format, buf } = await detectFormat(f);
      await addBook({ buf, format, hint: f.name.replace(/\.[^.]+$/, "") });
      ok++;
    } catch (err) { toast("Не вдалося відкрити «" + f.name + "»: " + err.message, 5000); await sleep(1500); }
  }
  if (ok) { showView("libView"); toast(ok === 1 ? "Книгу додано" : "Додано книг: " + ok); }
});

/* ---------- Пошук ---------- */
const LANGS = { uk: "Українська", en: "English", de: "Deutsch", fr: "Français", pl: "Polski", es: "Español", it: "Italiano", ru: "Російська", la: "Latina", fi: "Suomi", nl: "Nederlands", pt: "Português" };
const langName = arr => (arr || []).map(l => LANGS[l] || l).join(", ");
const flipName = n => (n || "").includes(",") ? n.split(",").reverse().map(s => s.trim()).join(" ") : n;
const NOTES = {
  gutenberg: "Project Gutenberg: понад 70 000 вільних книг, переважно класика. Найкращий вибір для англійської та іноземної літератури.",
  wikisource: "Вікіджерела: українська класика, поезія й проза, що вже стали суспільним надбанням.",
  archive: "Internet Archive: відкриті книги в EPUB (лише ті, що можна завантажити вільно)."
};
const SHELVES = {
  gutenberg: [
    { l: "Популярне", t: "" }, { l: "Для дітей", t: "children" }, { l: "Казки", t: "fairy tales" },
    { l: "Фентезі", t: "fantasy" }, { l: "Пригоди", t: "adventure" }, { l: "Романтика", t: "romance" },
    { l: "Фантастика", t: "science fiction" }, { l: "Детективи", t: "detective" }, { l: "Поезія", t: "poetry" }
  ],
  wikisource: [
    { l: "Казки", q: "казка" }, { l: "Для дітей", q: "для дітей" }, { l: "Оповідання", q: "оповідання" },
    { l: "Поезія", q: "поезія" }, { l: "Леся Українка", q: "Леся Українка" }, { l: "Марко Вовчок", q: "Марко Вовчок" },
    { l: "Франко", q: "Франко" }, { l: "Шевченко", q: "Шевченко" }
  ],
  archive: [
    { l: "Дитячі", q: "children" }, { l: "Казки", q: "fairy tales" }, { l: "Пригоди", q: "adventure" },
    { l: "Фентезі", q: "fantasy" }, { l: "Класика", q: "classic" }
  ]
};
let srcSel = "gutenberg", langSel = "", page = 1, lastQuery = "", results = [], browsed = false;
const shelfIdx = { gutenberg: 0, wikisource: 0, archive: 0 };

function renderShelves() {
  $("#shelfChips").innerHTML = SHELVES[srcSel].map((s, i) =>
    `<button class="chip${!lastQuery && i === shelfIdx[srcSel] ? " on" : ""}" data-i="${i}">${esc(s.l)}</button>`).join("");
}
$("#shelfChips").addEventListener("click", e => {
  const c = e.target.closest(".chip"); if (!c) return;
  shelfIdx[srcSel] = +c.dataset.i; lastQuery = ""; $("#q").value = "";
  renderShelves(); doSearch(1);
});
function setSrc(s) {
  srcSel = s;
  $$("#srcChips .chip").forEach(c => c.classList.toggle("on", c.dataset.src === s));
  $("#langChips").hidden = s !== "gutenberg";
  $("#srcNote").textContent = NOTES[s];
  renderShelves();
}
$$("#srcChips .chip").forEach(c => c.onclick = () => { setSrc(c.dataset.src); doSearch(1); });
$$("#langChips .chip").forEach(c => c.onclick = () => {
  langSel = c.dataset.lang;
  $$("#langChips .chip").forEach(x => x.classList.toggle("on", x === c));
  doSearch(1);
});
$("#searchForm").addEventListener("submit", e => {
  e.preventDefault();
  lastQuery = $("#q").value.trim();
  $("#q").blur(); renderShelves(); doSearch(1);
});
setSrc("gutenberg");

const magic = fmt => b => fmt === "epub" ? isZip(b) : b.byteLength > 200;

const SOURCES = {
  async gutenberg(qs, p, topic) {
    const j = await fetchJSON(`https://gutendex.com/books/?${qs ? "search=" + encodeURIComponent(qs) : ""}${topic ? "&topic=" + encodeURIComponent(topic) : ""}${langSel ? "&languages=" + langSel : ""}${p > 1 ? "&page=" + p : ""}`);
    return {
      more: !!j.next,
      items: j.results.map(b => {
        const f = b.formats || {};
        const epub = f["application/epub+zip"];
        const tk = Object.keys(f).find(k => k.startsWith("text/plain"));
        const dl = epub ? { url: epub, format: "epub" } : tk ? { url: f[tk], format: "txt" } : null;
        return {
          key: "gutenberg:" + b.id, title: b.title, author: (b.authors || []).map(a => flipName(a.name)).join(", "),
          meta: [langName(b.languages), dl ? dl.format.toUpperCase() : ""].filter(Boolean).join(" · "), cover: f["image/jpeg"], canDl: !!dl,
          get: async onProgress => ({ buf: await fetchBuf(dl.url, { onProgress, check: magic(dl.format) }), format: dl.format, coverUrl: f["image/jpeg"] })
        };
      })
    };
  },

  async archive(qs, p) {
    const t = qs.replace(/["():\\]/g, " ").trim();
    const query = `(title:(${t}) OR creator:(${t})) AND mediatype:texts AND format:epub AND NOT access-restricted-item:true`;
    const j = await fetchJSON(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=language&rows=20&page=${p}&sort[]=downloads+desc&output=json`);
    const docs = (j.response && j.response.docs) || [];
    return {
      more: j.response && j.response.numFound > p * 20,
      items: docs.map(d => ({
        key: "archive:" + d.identifier, title: [].concat(d.title || d.identifier)[0], author: [].concat(d.creator || []).join(", "),
        meta: [[].concat(d.language || []).join(", "), "EPUB"].filter(Boolean).join(" · "), cover: "https://archive.org/services/img/" + d.identifier, canDl: true,
        get: async onProgress => {
          const m = await fetchJSON("https://archive.org/metadata/" + d.identifier);
          const f = (m.files || []).find(x => /\.epub$/i.test(x.name));
          if (!f) throw new Error("EPUB-файл недоступний");
          const buf = await fetchBuf(`https://archive.org/download/${d.identifier}/${encodeURIComponent(f.name)}`, { onProgress, check: magic("epub") });
          return { buf, format: "epub", coverUrl: "https://archive.org/services/img/" + d.identifier };
        }
      }))
    };
  },

  async wikisource(qs, p) {
    const WS = "https://uk.wikisource.org/w/api.php";
    const j = await fetchJSON(`${WS}?action=query&list=search&srsearch=${encodeURIComponent(qs)}&srnamespace=0&srlimit=20&sroffset=${(p - 1) * 20}&format=json&origin=*`);
    const list = (j.query && j.query.search) || [];
    return {
      more: !!j.continue,
      items: list.map(r => ({
        key: "wikisource:" + r.title, title: r.title, author: r.snippet.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").slice(0, 110),
        meta: "Українська · Вікіджерела", cover: null, canDl: true,
        get: async onProgress => ({ buf: await wsBook(WS, r.title, onProgress), format: "html" })
      }))
    };
  }
};

async function wsBook(WS, title, onProgress) {
  let done = 0, total = 1;
  const parse = async t => {
    const j = await fetchJSON(`${WS}?action=parse&page=${encodeURIComponent(t)}&prop=text|displaytitle&format=json&formatversion=2&redirects=1&disableeditsection=1&origin=*`);
    if (!j.parse) throw new Error("Сторінку не знайдено");
    return j.parse;
  };
  const clean = html => {
    const d = new DOMParser().parseFromString(html, "text/html");
    const root = d.body;
    root.querySelectorAll(".mw-editsection,.noprint,.ws-noexport,.mw-empty-elt,.printfooter,#toc,.toc,.navbox,.sisterproject,.ambox,figure,.thumb,img,sup.reference,.reference,.mw-references-wrap,[role=note]").forEach(x => x.remove());
    sanitize(root);
    return root;
  };
  const collect = async (t, depth) => {
    const pr = await parse(t);
    done++;
    const root = clean(pr.text);
    const subs = [];
    root.querySelectorAll("a[href^='/wiki/']").forEach(a => {
      let tt; try { tt = decodeURIComponent(a.getAttribute("href").slice(6)).replace(/_/g, " "); } catch (e) { return; }
      if (tt.startsWith(t + "/") && !subs.includes(tt)) subs.push(tt);
    });
    const textLen = root.textContent.replace(/\s+/g, " ").length;
    if (subs.length >= 2 && textLen < subs.length * 500 && depth < 2) {
      const batch = subs.slice(0, 160);
      total += batch.length;
      const out = [];
      for (let i = 0; i < batch.length; i += 4) {
        const part = await Promise.all(batch.slice(i, i + 4).map(s => collect(s, depth + 1).catch(() => { done++; return []; })));
        part.forEach(x => out.push(...x));
        onProgress && onProgress(Math.min(0.98, done / total), 0);
      }
      return out;
    }
    root.querySelectorAll("a").forEach(a => a.replaceWith(...a.childNodes));
    return [{ title: t.split("/").pop(), html: root.innerHTML }];
  };
  const chapters = (await collect(title, 0)).filter(c => c.html.replace(/<[^>]+>/g, "").trim().length > 20);
  if (!chapters.length) throw new Error("У цій сторінці немає тексту");
  return new TextEncoder().encode(JSON.stringify({ title, author: "", chapters })).buffer;
}

async function doSearch(p) {
  page = p;
  const box = $("#results");
  if (p === 1) { results = []; box.innerHTML = '<div class="spin"></div>'; }
  else box.querySelector(".more")?.remove();
  try {
    const sh = lastQuery ? null : SHELVES[srcSel][shelfIdx[srcSel]];
    const r = await SOURCES[srcSel](lastQuery || (sh && sh.q) || "", p, (sh && sh.t) || "");
    results = results.concat(r.items);
    renderResults(r.more);
    if (!results.length) box.innerHTML = '<div class="note">Нічого не знайдено. Спробуй іншу назву, автора або інше джерело.</div>';
  } catch (e) {
    box.innerHTML = `<div class="note err">Не вдалося виконати пошук: ${esc(e.message)}.<br>Перевір інтернет або вкажи свій проксі в налаштуваннях.</div>`;
  }
}

function coverHtml(r) {
  const b = { title: r.title, author: r.author };
  return r.cover ? `<div class="cover"><img src="${esc(r.cover)}" alt="" loading="lazy" onerror="this.parentNode.outerHTML=genCoverHtml(this.dataset.t,this.dataset.a)" data-t="${esc(r.title)}" data-a="${esc(r.author)}"></div>` : genCover(b) + "</div>";
}
window.genCoverHtml = (t, a) => genCover({ title: t, author: a }) + "</div>";

function renderResults(more) {
  $("#results").innerHTML = results.map((r, i) => `
    <div class="res" data-i="${i}">
      ${coverHtml(r)}
      <div class="info"><b>${esc(r.title)}</b><span>${esc(r.author || "—")}</span><span>${esc(r.meta)}</span>
        <div class="act"></div></div>
    </div>`).join("") + (more ? '<button class="btn more" id="moreBtn">Показати ще</button>' : "");
  $("#moreBtn") && ($("#moreBtn").onclick = () => doSearch(page + 1));
  refreshResultButtons();
}

const busy = new Set();
function refreshResultButtons() {
  $$("#results .res").forEach(el => {
    const r = results[+el.dataset.i]; if (!r) return;
    const act = el.querySelector(".act");
    if (busy.has(r.key)) return;
    const have = books.find(b => b.src === r.key);
    if (have) act.innerHTML = `<button class="btn sm primary" data-open="${have.id}">Читати</button><span style="font-size:12.5px;color:var(--fg2)">у бібліотеці</span>`;
    else if (!r.canDl) act.innerHTML = '<span class="err">Немає придатного формату</span>';
    else act.innerHTML = '<button class="btn sm primary" data-dl="1">Завантажити</button>';
  });
}

$("#results").addEventListener("click", async e => {
  const op = e.target.closest("[data-open]");
  if (op) return openReader(op.dataset.open);
  const dl = e.target.closest("[data-dl]"); if (!dl) return;
  const el = dl.closest(".res"), r = results[+el.dataset.i], act = el.querySelector(".act");
  busy.add(r.key);
  act.innerHTML = '<div class="prog"><i></i></div><span style="font-size:12px;color:var(--fg2)" class="pct">0%</span>';
  const bar = act.querySelector("i"), pct = act.querySelector(".pct");
  const onP = (f, got) => {
    const v = f == null ? Math.min(0.9, (got || 0) / 2e6) : f;
    bar.style.width = Math.round(v * 100) + "%"; pct.textContent = Math.round(v * 100) + "%";
  };
  try {
    const got = await r.get(onP);
    bar.style.width = "100%"; pct.textContent = "готую…";
    await addBook({ buf: got.buf, format: got.format, src: r.key, title: r.title, author: r.author, coverUrl: got.coverUrl });
    toast("Додано в бібліотеку");
  } catch (err) {
    act.innerHTML = `<div class="err">Не вдалося завантажити (${esc(err.message)}).<br><button class="btn sm" data-dl="1" style="margin-top:6px">Ще раз</button></div>`;
  } finally { busy.delete(r.key); refreshResultButtons(); }
});

/* ---------- Налаштування (вікно) ---------- */
$("#gearBtn").onclick = async () => {
  $("#proxyIn").value = S.proxy || "";
  $("#settings").hidden = false;
  try {
    const e = await navigator.storage.estimate();
    $("#storageInfo").textContent = `Версія ${BUILD}. Книги займають ${(e.usage / 1048576).toFixed(1)} МБ із доступних ${(e.quota / 1048576 / 1024).toFixed(1)} ГБ. Усе зберігається лише на цьому пристрої.`;
  } catch (err) { $("#storageInfo").textContent = `Версія ${BUILD}. Усе зберігається лише на цьому пристрої.`; }
};
$("#saveSettings").onclick = () => { S.proxy = $("#proxyIn").value.trim(); saveS(); $("#settings").hidden = true; toast("Збережено"); };
$$("[data-close]").forEach(b => b.addEventListener("click", () => { $("#" + b.dataset.close).hidden = true; }));
$$(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m) m.hidden = true; }));
$$("#themeSeg2 button").forEach(b => b.onclick = () => { S.theme = b.dataset.v; saveS(); applyTheme(); });

/* ---------- Читалка ---------- */
let R = null, wake = null;
const scroller = $("#rScroll"), pageEl = $("#rPage"), readerEl = $("#reader");

async function openReader(id) {
  const meta = books.find(b => b.id === id) || (await dbAll()).find(b => b.id === id);
  if (!meta) return;
  toast("Відкриваю…", 6000);
  try {
    const rec = await fileGet(id);
    if (!rec) throw new Error("файл книги не знайдено");
    const book = await parseBook(meta.format, rec.buf, meta.title);
    R = { meta, book, ci: 0, tok: 0, chromeOff: true, userScrolled: false, lastTop: 0 };
    readerEl.hidden = false;
    readerEl.classList.add("chromeOff");
    $("#toast").hidden = true;
    $("#rTitle").textContent = meta.title;
    applyTheme(); applyReadStyle();
    closePanels();
    buildToc();
    history.pushState({ reader: 1 }, "");
    requestWake();
    let c = meta.pos.c || 0, f = meta.pos.f || 0;
    if (f > 0.95) { if (c < book.n - 1) c++; f = 0; }          // дочитаний розділ → наступний (або початок останнього)
    if (c === 0 && f === 0) {                                  // пропускаємо порожні службові сторінки на початку
      for (let k = 0; k < 4 && c < book.n - 1; k++) {
        let h = ""; try { h = await book.html(c); } catch (e) {}
        if (/<img/i.test(h) || h.replace(/<[^>]+>/g, "").trim().length > 80) break;
        c++;
      }
    }
    await showChapter(c, f);
  } catch (e) {
    toast("Не вдалося відкрити книгу: " + e.message, 5000);
    R = null; readerEl.hidden = true;
  }
}

async function closeReader() {
  if (!R) return;
  savePos(true);
  R.book.dispose();
  R = null;
  readerEl.hidden = true;
  closePanels();
  releaseWake();
  applyTheme();
  await renderLib();
}
window.addEventListener("popstate", () => { if (R) closeReader(); });
$("#rBack").onclick = () => history.back();

async function showChapter(ci, f = 0, anchor = null) {
  if (!R) return;
  ci = clamp(ci, 0, R.book.n - 1);
  R.ci = ci;
  const tok = ++R.tok;
  let html;
  try { html = await R.book.html(ci); } catch (e) { html = "<p>Не вдалося відкрити цей розділ.</p>"; }
  if (!R || tok !== R.tok) return;
  const n = R.book.n;
  const nav = `<div class="chNav">${ci > 0 ? '<button data-nav="-1">← Назад</button>' : ""}${ci < n - 1 ? `<button class="next" data-nav="1">Далі: ${esc(R.book.titles[ci + 1])} →</button>` : '<button disabled>Кінець книги</button>'}</div>`;
  pageEl.innerHTML = html + nav;
  R.userScrolled = false;
  const place = () => {
    if (!R || tok !== R.tok || R.userScrolled) return;
    if (anchor) {
      let el = null;
      try { el = pageEl.querySelector("#" + CSS.escape(anchor)); } catch (e) {}
      if (el) { el.scrollIntoView(); return; }
    }
    scroller.scrollTop = f * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  };
  scroller.scrollTop = 0;
  place(); setTimeout(place, 250); setTimeout(place, 800);
  updateProgress();
}

const curFrac = () => { const m = scroller.scrollHeight - scroller.clientHeight; return m > 4 ? clamp(scroller.scrollTop / m, 0, 1) : 0; };
const overall = () => R ? (R.ci + curFrac()) / R.book.n : 0;

function chapterLabel() {
  if (!R) return "";
  const t = R.book.toc.filter(x => x.ch <= R.ci).pop();
  return (t && t.title) || R.book.titles[R.ci] || "";
}
function updateProgress() {
  if (!R) return;
  const p = overall();
  $("#rSlider").value = Math.round(p * 1000);
  $("#rPct").textContent = Math.round(p * 100) + "%";
  $("#rChap").textContent = chapterLabel();
}
let saveT, scrollRaf;
scroller.addEventListener("scroll", () => {
  if (!R) return;
  R.userScrolled = true;
  if (!R.chromeOff && Math.abs(scroller.scrollTop - R.lastTop) > 50) setChrome(false);
  cancelAnimationFrame(scrollRaf);
  scrollRaf = requestAnimationFrame(updateProgress);
  clearTimeout(saveT);
  saveT = setTimeout(() => savePos(), 700);
}, { passive: true });
["touchstart", "wheel"].forEach(ev => scroller.addEventListener(ev, () => { if (R) R.userScrolled = true; }, { passive: true }));

function savePos(now) {
  if (!R) return;
  const m = R.meta;
  const f = R.userScrolled ? curFrac() : (R.ci === (m.pos && m.pos.c) ? m.pos.f || 0 : 0);
  m.pos = { c: R.ci, f };
  m.pct = Math.round(((R.ci + f) / R.book.n) * 100);
  m.last = Date.now();
  dbPut(m).catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) savePos(true); else if (R) requestWake();
});
window.addEventListener("pagehide", () => savePos(true));

function setChrome(on) {
  if (!R) return;
  R.chromeOff = !on;
  R.lastTop = scroller.scrollTop;
  readerEl.classList.toggle("chromeOff", !on);
}
const panelsOpen = () => !$("#rPanel").hidden || !$("#rTocPanel").hidden;
function closePanels() { $("#rPanel").hidden = true; $("#rTocPanel").hidden = true; }

function pageBy(dir) {
  if (!R) return;
  const max = scroller.scrollHeight - scroller.clientHeight;
  if (dir > 0) {
    if (scroller.scrollTop >= max - 6) { if (R.ci < R.book.n - 1) showChapter(R.ci + 1, 0); else toast("Це кінець книги"); }
    else scroller.scrollBy({ top: scroller.clientHeight * 0.88, behavior: "smooth" });
  } else {
    if (scroller.scrollTop <= 6) { if (R.ci > 0) showChapter(R.ci - 1, 1); }
    else scroller.scrollBy({ top: -scroller.clientHeight * 0.88, behavior: "smooth" });
  }
}

scroller.addEventListener("click", e => {
  if (!R) return;
  const nb = e.target.closest("[data-nav]");
  if (nb) { const d = +nb.dataset.nav; showChapter(R.ci + d, d < 0 ? 1 : 0); return; }
  const a = e.target.closest("a[data-path]");
  if (a) {
    const idx = R.book.link(a.dataset.path);
    if (idx >= 0) showChapter(idx, 0, a.dataset.id || null);
    return;
  }
  const fn = e.target.closest(".fnref");
  if (fn) { toast(fn.dataset.n || "Примітка", 8000); return; }
  if (e.target.closest("a[href]")) return;
  if (String(getSelection())) return;
  if (panelsOpen()) { closePanels(); return; }
  const x = e.clientX / innerWidth;
  if (x < 0.27) pageBy(-1); else if (x > 0.73) pageBy(1); else setChrome(R.chromeOff);
});

/* слайдер */
$("#rSlider").addEventListener("input", e => { $("#rPct").textContent = Math.round(e.target.value / 10) + "%"; });
$("#rSlider").addEventListener("change", e => {
  if (!R) return;
  const v = (e.target.value / 1000) * R.book.n;
  const ci = Math.min(R.book.n - 1, Math.floor(v));
  showChapter(ci, v - ci);
});

/* зміст */
function buildToc() {
  const list = R.book.toc.length ? R.book.toc : R.book.titles.map((t, i) => ({ title: t, ch: i, id: "", lvl: 0 }));
  $("#tocList").innerHTML = list.map((t, i) => `<button class="tocItem l${Math.min(2, t.lvl || 0)}" data-i="${i}">${esc(t.title)}</button>`).join("");
  $("#tocList").onclick = e => {
    const b = e.target.closest(".tocItem"); if (!b) return;
    const t = list[+b.dataset.i];
    closePanels(); showChapter(t.ch, 0, t.id || null);
  };
}
$("#rToc").onclick = () => {
  if (!R) return;
  $("#rPanel").hidden = true;
  const open = $("#rTocPanel").hidden;
  $("#rTocPanel").hidden = !open;
  if (open) {
    const items = $$("#tocList .tocItem");
    const list = R.book.toc.length ? R.book.toc : R.book.titles.map((t, i) => ({ ch: i }));
    let cur = -1; list.forEach((t, i) => { if (t.ch <= R.ci) cur = i; });
    items.forEach((b, i) => b.classList.toggle("cur", i === cur));
    items[cur] && items[cur].scrollIntoView({ block: "center" });
  }
};
$("#rAa").onclick = () => { $("#rTocPanel").hidden = true; $("#rPanel").hidden = !$("#rPanel").hidden; };

/* вигляд */
function restyle(fn) {
  const f = curFrac();
  fn(); saveS(); applyTheme(); applyReadStyle();
  requestAnimationFrame(() => { scroller.scrollTop = f * Math.max(0, scroller.scrollHeight - scroller.clientHeight); updateProgress(); });
}
$("#fsMinus").onclick = () => restyle(() => (S.size = clamp(S.size - 1, 13, 34)));
$("#fsPlus").onclick = () => restyle(() => (S.size = clamp(S.size + 1, 13, 34)));
$$("#fontSeg button").forEach(b => b.onclick = () => restyle(() => (S.font = b.dataset.v)));
$$("#lhSeg button").forEach(b => b.onclick = () => restyle(() => (S.lh = +b.dataset.v)));
$$("#mgSeg button").forEach(b => b.onclick = () => restyle(() => (S.mg = +b.dataset.v)));
$$("#themeSeg button").forEach(b => b.onclick = () => restyle(() => (S.theme = b.dataset.v)));

/* клавіатура (для ПК) */
document.addEventListener("keydown", e => {
  if (!R || e.target.tagName === "INPUT") return;
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); pageBy(1); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); pageBy(-1); }
  else if (e.key === "Escape") history.back();
});

/* екран не гасне під час читання */
async function requestWake() { try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch (e) {} }
function releaseWake() { try { wake && wake.release(); } catch (e) {} wake = null; }

/* ---------- Оновлення застосунку ---------- */
async function hardRefresh() {
  toast("Оновлюю…", 4000);
  try {
    if ("serviceWorker" in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); }
    if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
    await Promise.all(["./", "index.html", "app.js", "style.css", "sw.js"].map(u => fetch(u, { cache: "reload" }).catch(() => {})));
  } catch (e) {}
  location.reload();
}
$("#refreshBtn").onclick = hardRefresh;
$("#updateBtn").onclick = hardRefresh;

/* ---------- Старт ---------- */
applyTheme(); applyReadStyle();
(async () => {
  try {
    if (!localStorage.getItem("ch_posfix2")) {
      for (const b of await dbAll()) { b.pos = { c: 0, f: 0 }; b.pct = 0; await dbPut(b); }
      localStorage.setItem("ch_posfix2", "1");
    }
  } catch (e) {}
  renderLib();
})();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  const hadCtl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadCtl && !R && !busy.size) location.reload(); });
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
