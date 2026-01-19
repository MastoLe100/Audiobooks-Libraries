"use strict";

/*
  Hub JS V2 - overlay fix:
  - ferme l overlay sur: clic n importe ou, touche n importe laquelle, ou bouton
  - unlock audio sur la premiere interaction (si possible)
*/

const state = {
    libs: [],
    sfxOn: true,
    musicOn: true,
    visualsOn: true,
    volume: 0.5,
    audioCtx: null,
    masterGain: null,
    musicEl: null,
    unlocked: false,
};

const DIGIMON_GIFS = [
    "https://media.tenor.com/13TdTMtSmRkAAAAM/agumon-digimon.gif",
    "https://media.tenor.com/vDFOQ_8GnuMAAAAj/patamon-digimon.gif",
    "https://media.tenor.com/Qw02VjEVv5oAAAAM/digimon-gatomon.gif",
    "https://media.tenor.com/aU19-5JFjKEAAAAM/digimon-digimon-adventure.gif",
    "https://media.tenor.com/np2k-jHL1zkAAAAM/digimon-digimon-adventure.gif",
    "https://media.tenor.com/3ohBMsJnS84AAAAM/digimon-adventure-digimon.gif",
    "https://media.tenor.com/4etz6Srq0DkAAAAM/digimon-digimon-adventure.gif",
    "https://media.tenor.com/XLpZvV2iAPkAAAAM/digimon-anime.gif",
    "https://media.tenor.com/NJD20NdHhwAAAAAM/digimon-patamon.gif",
    "https://media.tenor.com/Tf-F85ZbPHIAAAAM/digimon-patamon.gif",
    "https://media1.tenor.com/m/wRGQJMgaZkwAAAAd/digimon-adventure.gif",
    "https://media1.tenor.com/m/Mt5H8uUHU0AAAAAd/digimon-gabumon.gif",
    "https://media1.tenor.com/m/7vNqu5rPMCcAAAAd/digimon-digivolve.gif",
    "https://media1.tenor.com/m/KxbSjkCZje8AAAAd/digimon-greymon.gif",
    "https://media1.tenor.com/m/CyRSUC1yDIcAAAAd/gabumon-bite.gif",
    "https://media1.tenor.com/m/mNU6NkYseegAAAAd/digimon-digimon-adventure.gif",
    "https://media1.tenor.com/m/fRUfCXbgNw0AAAAd/digimon-digimon-adventure.gif",
    "https://media1.tenor.com/m/uLSJ0BSkTBEAAAAd/digimon-adventure.gif",
    "https://media1.tenor.com/m/MAtg4nn1iCEAAAAd/digimon-digimon-adventure.gif"
];

function $(id) { return document.getElementById(id); }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function setToggle(btn, on, label) {
    if (!btn) return;
    btn.textContent = `${label}: ${on ? "ON" : "OFF"}`;
    btn.classList.toggle("off", !on);
}

async function fetchJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch ${path} (${res.status})`);
    return await res.json();
}

function ensureMusicElement() {
    if (state.musicEl) return;
    const el = new Audio("assets/audio/bgm_butterfly_chiptune.mp3");
    el.loop = true;
    el.preload = "auto";
    state.musicEl = el;
}

function syncAudio() {
    if (state.masterGain) state.masterGain.gain.value = clamp01(state.volume);

    ensureMusicElement();
    state.musicEl.volume = clamp01(state.volume);

    if (!state.unlocked) return;

    if (state.musicOn) {
        state.musicEl.play().catch(() => { });
    } else {
        state.musicEl.pause();
        state.musicEl.currentTime = 0;
    }
}

/* WebAudio SFX */
function beep(opts) {
    const o = opts || {};
    const freq = o.freq ?? 740;
    const dur = o.dur ?? 0.045;
    const type = o.type ?? "square";
    const gain = o.gain ?? 0.12;
    const slideTo = o.slideTo ?? null;

    if (!state.unlocked) return;
    if (!state.sfxOn) return;
    if (!state.audioCtx || !state.masterGain) return;

    const t0 = state.audioCtx.currentTime;
    const osc = state.audioCtx.createOscillator();
    const g = state.audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(state.masterGain);

    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
}

function sfxHover() { beep({ freq: 880, dur: 0.03, type: "square", gain: 0.08, slideTo: 660 }); }
function sfxClick() {
    beep({ freq: 660, dur: 0.06, type: "square", gain: 0.11, slideTo: 990 });
    setTimeout(() => beep({ freq: 990, dur: 0.04, type: "square", gain: 0.08, slideTo: 660 }), 55);
}
function sfxToggleOff() { beep({ freq: 220, dur: 0.07, type: "square", gain: 0.10, slideTo: 140 }); }

async function unlockAudio() {
    if (state.unlocked) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioContext();

    state.masterGain = state.audioCtx.createGain();
    state.masterGain.gain.value = clamp01(state.volume);
    state.masterGain.connect(state.audioCtx.destination);

    state.unlocked = true;
    syncAudio();
}

function escapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* Preview parsing (best effort) */
function extractCoverUrlsFromHtml(html, limit) {
    const cap = limit ?? 6;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imgs = Array.from(doc.querySelectorAll("img"));
    const urls = [];

    for (const img of imgs) {
        const src = img.getAttribute("src") || "";
        if (!src) continue;

        const w = parseInt(img.getAttribute("width") || "0", 10);
        const h = parseInt(img.getAttribute("height") || "0", 10);

        const looksTiny = w && h && (w < 40 || h < 40);
        const looksIcon = /icon|logo|sprite|favicon/i.test(src);

        if (looksTiny || looksIcon) continue;

        urls.push(src);
        if (urls.length >= cap) break;
    }

    return urls;
}

async function fetchGalleryPreview(libSlug) {
    try {
        const res = await fetch(`${libSlug}/index.html`, { cache: "no-store" });
        if (!res.ok) return [];
        const html = await res.text();
        const rels = extractCoverUrlsFromHtml(html, 6);

        return rels.map((u) => {
            if (/^https?:\/\//i.test(u)) return u;
            return `${libSlug}/${u.replace(/^\.\//, "")}`;
        });
    } catch {
        return [];
    }
}

function renderCards(libs) {
    const grid = $("cardsGrid");
    if (!grid) return;
    grid.innerHTML = "";

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

        let hoverCooldown = false;
        card.addEventListener("mouseenter", () => {
            if (hoverCooldown) return;
            hoverCooldown = true;
            sfxHover();
            setTimeout(() => (hoverCooldown = false), 100);
        });

        card.addEventListener("click", () => {
            sfxClick();
            window.location.href = `${lib.slug}/index.html`;
        });

        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                sfxClick();
                window.location.href = `${lib.slug}/index.html`;
            }
        });

        grid.appendChild(card);

        fetchGalleryPreview(lib.slug).then((urls) => {
            const row = document.getElementById(`preview-${lib.slug}`);
            if (!row) return;
            row.innerHTML = urls.map((u) => `<img class="previewImg" src="${u}" alt="" loading="lazy" />`).join("");
        });
    }
}

function renderGifWall() {
    const gifGrid = $("gifGrid");
    if (!gifGrid) return;
    gifGrid.innerHTML = "";

    for (const url of DIGIMON_GIFS) {
        const box = document.createElement("div");
        box.className = "gifItem";
        box.innerHTML = `<img src="${url}" alt="" loading="lazy" />`;
        box.addEventListener("mouseenter", () => sfxHover());
        box.addEventListener("click", () => sfxClick());
        gifGrid.appendChild(box);
    }
}

function bindUI() {
    const toggleSfx = $("toggleSfx");
    const toggleMusic = $("toggleMusic");
    const toggleVisuals = $("toggleVisuals");
    const volumeSlider = $("volumeSlider");
    const volumeValue = $("volumeValue");

    setToggle(toggleSfx, state.sfxOn, "SFX");
    setToggle(toggleMusic, state.musicOn, "MUSIC");
    setToggle(toggleVisuals, state.visualsOn, "VISUALS");

    if (toggleSfx) {
        toggleSfx.addEventListener("click", () => {
            if (state.sfxOn) sfxToggleOff(); else sfxClick();
            state.sfxOn = !state.sfxOn;
            setToggle(toggleSfx, state.sfxOn, "SFX");
        });
    }

    if (toggleMusic) {
        toggleMusic.addEventListener("click", () => {
            sfxClick();
            state.musicOn = !state.musicOn;
            setToggle(toggleMusic, state.musicOn, "MUSIC");
            syncAudio();
        });
    }

    if (toggleVisuals) {
        toggleVisuals.addEventListener("click", () => {
            sfxClick();
            state.visualsOn = !state.visualsOn;
            setToggle(toggleVisuals, state.visualsOn, "VISUALS");
            const bgLayer = document.querySelector(".bgLayer");
            if (bgLayer) bgLayer.style.display = state.visualsOn ? "block" : "none";
        });
    }

    if (volumeSlider) {
        volumeSlider.addEventListener("input", () => {
            state.volume = clamp01(Number(volumeSlider.value) / 100);
            if (volumeValue) volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
            syncAudio();
        });
    }
}

/* Overlay: ferme sur n importe quel clic ou touche */
function bindOverlay() {
    const overlay = $("enterOverlay");
    const btn = $("enterBtn");
    if (!overlay) return;

    const statusText = $("statusText");

    async function enter() {
        try {
            await unlockAudio();
            sfxClick();
        } catch (e) {
            console.error(e);
        }
        overlay.style.display = "none";
        if (statusText) statusText.textContent = `SYSTEM READY: ${state.libs.length}`;
    }

    // bouton
    if (btn) {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            enter();
        }, { capture: true });
    }

    // clic n importe ou (meme sur la card)
    document.addEventListener("pointerdown", () => {
        if (overlay.style.display !== "none") enter();
    }, { capture: true });

    // n importe quelle touche
    document.addEventListener("keydown", () => {
        if (overlay.style.display !== "none") enter();
    }, { capture: true });
}

async function main() {
    const statusText = $("statusText");
    if (statusText) statusText.textContent = "SYSTEM BOOT...";

    state.volume = 0.5;
    const volumeSlider = $("volumeSlider");
    const volumeValue = $("volumeValue");
    if (volumeSlider) volumeSlider.value = "50";
    if (volumeValue) volumeValue.textContent = "50%";

    bindUI();
    renderGifWall();
    bindOverlay();

    if (statusText) statusText.textContent = "LOADING LIBRARIES...";
    try {
        state.libs = await fetchJSON("libraries.json");
    } catch (e) {
        console.error(e);
        if (statusText) statusText.textContent = "ERROR: libraries.json";
        return;
    }

    renderCards(state.libs);
    if (statusText) statusText.textContent = `SYSTEM READY: ${state.libs.length}`;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => main().catch(console.error));
} else {
    main().catch(console.error);
}
