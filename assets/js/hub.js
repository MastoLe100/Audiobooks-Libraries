const state = {
    libs: [],
    // Audio toggles (pas de sauvegarde, comme tu veux)
    sfxOn: true,
    musicOn: true,
    visualsOn: true,
    volume: 0.5, // base 50%
    // Audio nodes
    audioCtx: null,
    masterGain: null,
    sfxHoverBuf: null,
    sfxClickBuf: null,
    musicEl: null,
    unlocked: false,
    // Index global livres
    booksIndex: [] // { title, author, libSlug, libLabel, link }
};

const els = {
    overlay: document.getElementById("enterOverlay"),
    enterBtn: document.getElementById("enterBtn"),
    cardsGrid: document.getElementById("cardsGrid"),
    statusText: document.getElementById("statusText"),
    searchInput: document.getElementById("searchInput"),
    results: document.getElementById("results"),
    toggleSfx: document.getElementById("toggleSfx"),
    toggleMusic: document.getElementById("toggleMusic"),
    toggleVisuals: document.getElementById("toggleVisuals"),
    volumeSlider: document.getElementById("volumeSlider"),
    volumeValue: document.getElementById("volumeValue"),
};

function setStatus(msg) { els.statusText.textContent = msg; }

function setToggle(btn, on, label) {
    btn.textContent = `${label}: ${on ? "ON" : "OFF"}`;
    btn.classList.toggle("off", !on);
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

async function fetchJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch ${path}`);
    return await res.json();
}

// Heuristique ALE: on va chercher des images qui ressemblent a des covers
function extractCoverUrlsFromHtml(html, limit = 6) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imgs = Array.from(doc.querySelectorAll("img"));
    const urls = [];

    for (const img of imgs) {
        const src = img.getAttribute("src") || "";
        if (!src) continue;

        // Filtre grossier pour eviter logos/icones
        const w = parseInt(img.getAttribute("width") || "0", 10);
        const h = parseInt(img.getAttribute("height") || "0", 10);

        const looksTiny = (w && h && (w < 40 || h < 40));
        const looksIcon = /icon|logo|sprite|favicon/i.test(src);

        if (looksTiny || looksIcon) continue;

        urls.push(src);
        if (urls.length >= limit) break;
    }
    return urls;
}

async function fetchGalleryPreview(libSlug) {
    try {
        const res = await fetch(`${libSlug}/index.html`, { cache: "no-store" });
        if (!res.ok) return [];
        const html = await res.text();
        // Convertit en URLs absolues par rapport au dossier de la galerie
        const rels = extractCoverUrlsFromHtml(html, 6);
        return rels.map(u => {
            if (/^https?:\/\//i.test(u)) return u;
            // relative to gallery folder
            return `${libSlug}/${u.replace(/^\.\//, "")}`;
        });
    } catch {
        return [];
    }
}

// Extraction “light” titres/auteurs depuis la galerie pour index global
// Heuristique: on prend du texte qui ressemble a "Title" / "Author" dans des blocs
function extractBooksFromHtml(html, lib) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Heuristique: beaucoup d exports ont des cartes/items avec du texte
    // On prend les elements qui contiennent des infos et on tente de detecter title/author.
    const candidates = Array.from(doc.querySelectorAll("article, li, .book, .item, .card, .grid-item, .library-item"));
    const books = [];

    const seen = new Set();

    for (const el of candidates) {
        const text = (el.textContent || "").trim().replace(/\s+/g, " ");
        if (text.length < 8) continue;

        // Patterns simples
        // On essaie de trouver "By ..." ou "Auteur" ou "Author"
        let title = "";
        let author = "";

        // Si il y a un titre dans un h1/h2/h3
        const heading = el.querySelector("h1,h2,h3");
        if (heading) title = (heading.textContent || "").trim();

        if (!title) {
            // fallback: premiere ligne du texte
            title = text.split(" · ")[0].split(" - ")[0].split("\n")[0].trim();
        }

        // author guess
        const mBy = text.match(/\bby\s+([^|•\-]+)$/i) || text.match(/\bby\s+([^|•\-]+)/i);
        if (mBy) author = mBy[1].trim();

        const mAuthor = text.match(/\b(author|auteur)\s*[:\-]\s*([^|•\-]+)/i);
        if (mAuthor) author = mAuthor[2].trim();

        // Garde seulement si ca ressemble a un livre
        if (!title || title.length < 2) continue;

        const key = `${lib.slug}::${title.toLowerCase()}::${author.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        books.push({
            title,
            author: author || "Unknown",
            libSlug: lib.slug,
            libLabel: lib.label,
            link: `${lib.slug}/index.html`
        });

        if (books.length >= 4000) break; // securite
    }

    // Limite par biblio pour eviter les trucs trop lourds si HTML enorme
    return books.slice(0, 1200);
}

async function buildGlobalIndex(libs) {
    const all = [];
    for (const lib of libs) {
        try {
            const res = await fetch(`${lib.slug}/index.html`, { cache: "no-store" });
            if (!res.ok) continue;
            const html = await res.text();
            const books = extractBooksFromHtml(html, lib);
            all.push(...books);
        } catch {
            // ignore
        }
    }
    return all;
}

function playSfx(buffer) {
    if (!state.unlocked) return;
    if (!state.sfxOn) return;
    if (!state.audioCtx || !state.masterGain || !buffer) return;

    const src = state.audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(state.masterGain);
    src.start(0);
}

async function loadAudioBuffers() {
    const ctx = state.audioCtx;

    async function loadBuf(url) {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        return await ctx.decodeAudioData(arr);
    }

    state.sfxHoverBuf = await loadBuf("assets/audio/sfx_hover.wav");
    state.sfxClickBuf = await loadBuf("assets/audio/sfx_click.wav");
}

function ensureMusicElement() {
    if (state.musicEl) return;
    const el = new Audio("assets/audio/bgm_butterfly_chiptune.mp3");
    el.loop = true;
    el.preload = "auto";
    state.musicEl = el;
}

function syncAudio() {
    // Master volume
    if (state.masterGain) state.masterGain.gain.value = clamp01(state.volume);

    // Music
    ensureMusicElement();
    state.musicEl.volume = clamp01(state.volume);

    if (state.unlocked) {
        if (state.musicOn) {
            // si autoplay bloque encore, on ignore l erreur
            state.musicEl.play().catch(() => { });
        } else {
            state.musicEl.pause();
            state.musicEl.currentTime = 0;
        }
    }
}

function renderCards(libs) {
    els.cardsGrid.innerHTML = "";
    for (const lib of libs) {
        const card = document.createElement("div");
        card.className = "card";
        card.tabIndex = 0;

        card.innerHTML = `
      <div class="cardTop">
        <img class="avatar" src="${lib.avatar}" alt="" />
        <div>
          <div class="cardLabel">${escapeHtml(lib.label)}</div>
          <div class="cardOwner">${escapeHtml(lib.owner)}</div>
        </div>
      </div>
      <div class="previewRow" id="preview-${lib.slug}"></div>
      <div class="cardHint">OPEN</div>
    `;

        // Hover + click SFX
        let hoverCooldown = false;
        card.addEventListener("mouseenter", () => {
            if (hoverCooldown) return;
            hoverCooldown = true;
            playSfx(state.sfxHoverBuf);
            setTimeout(() => hoverCooldown = false, 100);
        });

        card.addEventListener("click", () => {
            playSfx(state.sfxClickBuf);
            window.location.href = `${lib.slug}/index.html`;
        });

        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                playSfx(state.sfxClickBuf);
                window.location.href = `${lib.slug}/index.html`;
            }
        });

        els.cardsGrid.appendChild(card);

        // Apercu covers
        fetchGalleryPreview(lib.slug).then(urls => {
            const row = document.getElementById(`preview-${lib.slug}`);
            if (!row) return;
            if (!urls.length) {
                row.innerHTML = `<div class="cardOwner" style="margin-top:8px;">No preview found</div>`;
                return;
            }
            row.innerHTML = urls.map(u => `<img class="previewImg" src="${u}" alt="" loading="lazy" />`).join("");
        });
    }
}

function escapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function renderResults(items, q) {
    els.results.innerHTML = "";
    if (!q) {
        els.results.innerHTML = `<div class="panelStatus">Tape dans SEARCH pour trouver un titre ou un auteur.</div>`;
        return;
    }
    if (!items.length) {
        els.results.innerHTML = `<div class="panelStatus">Aucun resultat.</div>`;
        return;
    }

    const max = Math.min(items.length, 40);
    for (let i = 0; i < max; i++) {
        const it = items[i];
        const div = document.createElement("div");
        div.className = "resultItem";
        div.innerHTML = `
      <div class="resultTitle">${escapeHtml(it.title)}</div>
      <div class="resultMeta">${escapeHtml(it.author)}  |  ${escapeHtml(it.libLabel)}</div>
      <a class="resultLink" href="${it.link}">OPEN LIBRARY</a>
    `;
        div.addEventListener("mouseenter", () => playSfx(state.sfxHoverBuf));
        div.addEventListener("click", () => playSfx(state.sfxClickBuf));
        els.results.appendChild(div);
    }
}

function searchIndex(q) {
    const s = q.trim().toLowerCase();
    if (!s) return [];

    // match simple (title or author or lib label)
    const out = [];
    for (const b of state.booksIndex) {
        const hay = `${b.title} ${b.author} ${b.libLabel}`.toLowerCase();
        if (hay.includes(s)) out.push(b);
        if (out.length >= 200) break;
    }
    return out;
}

function bindUI() {
    setToggle(els.toggleSfx, state.sfxOn, "SFX");
    setToggle(els.toggleMusic, state.musicOn, "MUSIC");
    setToggle(els.toggleVisuals, state.visualsOn, "VISUALS");

    els.toggleSfx.addEventListener("click", () => {
        playSfx(state.sfxClickBuf);
        state.sfxOn = !state.sfxOn;
        setToggle(els.toggleSfx, state.sfxOn, "SFX");
    });

    els.toggleMusic.addEventListener("click", () => {
        playSfx(state.sfxClickBuf);
        state.musicOn = !state.musicOn;
        setToggle(els.toggleMusic, state.musicOn, "MUSIC");
        syncAudio();
    });

    els.toggleVisuals.addEventListener("click", () => {
        playSfx(state.sfxClickBuf);
        state.visualsOn = !state.visualsOn;
        setToggle(els.toggleVisuals, state.visualsOn, "VISUALS");
        document.body.classList.toggle("visualsOff", !state.visualsOn);
        document.querySelector(".bgLayer").style.display = state.visualsOn ? "block" : "none";
    });

    els.volumeSlider.addEventListener("input", () => {
        const v = Number(els.volumeSlider.value) / 100;
        state.volume = clamp01(v);
        els.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
        syncAudio();
    });

    let searchT = null;
    els.searchInput.addEventListener("input", () => {
        clearTimeout(searchT);
        searchT = setTimeout(() => {
            const q = els.searchInput.value;
            const hits = searchIndex(q);
            renderResults(hits, q);
        }, 80);
    });
}

async function unlockAudio() {
    if (state.unlocked) return;

    // Init AudioContext + master gain
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioContext();
    state.masterGain = state.audioCtx.createGain();
    state.masterGain.gain.value = state.volume;
    state.masterGain.connect(state.audioCtx.destination);

    await loadAudioBuffers();
    ensureMusicElement();

    state.unlocked = true;
    syncAudio();
}

async function main() {
    // Defaults
    state.volume = 0.5;
    els.volumeSlider.value = "50";
    els.volumeValue.textContent = "50%";
    setStatus("Loading libraries...");

    bindUI();

    // Load libraries
    state.libs = await fetchJSON("libraries.json");
    renderCards(state.libs);
    setStatus(`Libraries: ${state.libs.length}`);

    // Build global index
    setStatus("Indexing books...");
    state.booksIndex = await buildGlobalIndex(state.libs);
    setStatus(`Indexed: ${state.booksIndex.length} items`);

    // Init results idle
    renderResults([], "");

    // ENTER
    els.enterBtn.addEventListener("click", async () => {
        await unlockAudio();
        playSfx(state.sfxClickBuf);
        els.overlay.style.display = "none";
    });

    // Si l utilisateur clique n importe ou sur l overlay
    els.overlay.addEventListener("click", async (e) => {
        if (e.target === els.overlay) {
            await unlockAudio();
            playSfx(state.sfxClickBuf);
            els.overlay.style.display = "none";
        }
    });
}

main().catch(err => {
    console.error(err);
    setStatus("Error loading hub");
});
