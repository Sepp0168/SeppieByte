(function () {
  "use strict";

  const config = window.SEPPIEBYTE_CONFIG || {};
  const functionsBase = (config.functionsBase || "").replace(/\/$/, "");
  const anonKey = config.anonKey || "";

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const materials = {
    PLA: { density: 1.24, eurKg: 25, speed: 7.5 },
    PETG: { density: 1.27, eurKg: 18, speed: 6.2 },
  };

  const strengths = {
    Pweak: { label: "Prototype weak", shellMm: 0.8, infill: 0.08 },
    weak: { label: "Weak", shellMm: 1.2, infill: 0.15 },
    medium: { label: "Medium", shellMm: 1.6, infill: 0.25 },
    strong: { label: "Strong", shellMm: 2.4, infill: 0.40 },
  };

  const details = {
    Pbad: { label: "Prototype bad", layer: 0.28, multiplier: 0.80 },
    Bad: { label: "Bad", layer: 0.24, multiplier: 0.95 },
    Good: { label: "Good", layer: 0.16, multiplier: 1.25 },
    Fine: { label: "Fine", layer: 0.12, multiplier: 1.55 },
  };

  function estimateQuote(stats, materialKey, strengthKey, detailKey) {
    const material = materials[materialKey] || materials.PLA;
    const strength = strengths[strengthKey] || strengths.weak;
    const detail = details[detailKey] || details.Bad;
    const shellCm3 = Math.min(stats.volumeCm3, (stats.surfaceCm2 * 100 * strength.shellMm) / 1000);
    const infillCm3 = Math.max(0, stats.volumeCm3 - shellCm3) * strength.infill;
    const printedCm3 = shellCm3 + infillCm3;
    const weightG = printedCm3 * material.density;
    const minutes = Math.max(1, Math.ceil(((printedCm3 * 1000) / material.speed) * detail.multiplier / 60));
    const materialCost = (weightG / 1000) * material.eurKg * 7;
    const machineCost = (minutes / 60) * 0.5;
    const complexity = Math.min(4, (stats.surfaceCm2 / Math.max(stats.volumeCm3, 1)) * 0.18);
    const price = Math.max(3, materialCost + machineCost + 1.5 + complexity);
    return {
      price: round(price, 2),
      weight_g: round(weightG, 1),
      time: formatMinutes(minutes),
      print_time_minutes: minutes,
      volume_cm3: round(stats.volumeCm3, 2),
      surface_cm2: round(stats.surfaceCm2, 2),
      shell_volume_cm3: round(shellCm3, 2),
      infill_volume_cm3: round(infillCm3, 2),
      material: materialKey,
      strength: strength.label,
      detail: detail.label,
    };
  }

  function measureStl(bytes) {
    const isBinary = stlLooksBinary(bytes);
    const triangles = isBinary ? readBinaryStl(bytes) : readAsciiStl(new TextDecoder().decode(bytes));
    if (!triangles.length) throw new Error("No triangles found in the STL file.");

    let areaMm2 = 0;
    let signedVolumeMm3 = 0;
    triangles.forEach(([a, b, c]) => {
      areaMm2 += triangleArea(a, b, c);
      signedVolumeMm3 += dot(a, cross(b, c)) / 6;
    });

    const volumeMm3 = Math.abs(signedVolumeMm3);
    if (areaMm2 <= 0 || volumeMm3 <= 0) throw new Error("The STL needs a closed mesh with measurable surface and volume.");

    return {
      volumeCm3: volumeMm3 / 1000,
      surfaceCm2: areaMm2 / 100,
    };
  }

  function stlLooksBinary(bytes) {
    if (bytes.byteLength < 84) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triCount = view.getUint32(80, true);
    return 84 + triCount * 50 === bytes.byteLength;
  }

  function readBinaryStl(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triCount = view.getUint32(80, true);
    const triangles = [];
    let offset = 84;
    for (let i = 0; i < triCount; i += 1) {
      offset += 12;
      const tri = [];
      for (let v = 0; v < 3; v += 1) {
        tri.push([
          view.getFloat32(offset, true),
          view.getFloat32(offset + 4, true),
          view.getFloat32(offset + 8, true),
        ]);
        offset += 12;
      }
      triangles.push(tri);
      offset += 2;
    }
    return triangles;
  }

  function readAsciiStl(text) {
    const vertices = [...text.matchAll(/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] );
    const triangles = [];
    for (let i = 0; i + 2 < vertices.length; i += 3) {
      triangles.push([vertices[i], vertices[i + 1], vertices[i + 2]]);
    }
    return triangles;
  }

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function triangleArea(a, b, c) { return Math.sqrt(dot(cross(sub(b, a), sub(c, a)), cross(sub(b, a), sub(c, a)))) / 2; }

  async function calculateLocalQuote(file, link, material, strength, detail) {
    let bytes = null;
    let filename = "";
    let sourceLink = null;

    if (file && extension(file.name) === ".stl") {
      bytes = new Uint8Array(await file.arrayBuffer());
      filename = file.name;
    } else if (link && extension(link) === ".stl") {
      const downloaded = await tryDownloadClient(link);
      if (downloaded) {
        bytes = downloaded.bytes;
        filename = downloaded.filename;
        sourceLink = link;
      }
    }

    if (!bytes) return null;

    const stats = measureStl(bytes);
    return {
      quote: estimateQuote(stats, material, strength, detail),
      filename,
      sourceLink,
    };
  }

  async function tryDownloadClient(link) {
    const ext = extension(link);
    if (![".stl", ".3mf", ".obj"].includes(ext)) return null;
    try {
      const res = await fetch(link);
      if (!res.ok || (res.headers.get("content-type") || "").includes("text/html")) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { bytes, filename: decodeURIComponent(link.split("/").pop() || `model${ext}`) };
    } catch (err) {
      return null;
    }
  }

  const revealEls = document.querySelectorAll(".cart, .feature");
  if ("IntersectionObserver" in window && revealEls.length) {
    revealEls.forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(14px)";
      el.style.transition = `opacity .45s ease ${i * 80}ms, transform .45s ease ${i * 80}ms, border-color .18s, box-shadow .18s`;
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = "1";
          entry.target.style.transform = "translateY(0)";
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach((el) => io.observe(el));
  }

  window.TED = window.TED || {
    base64: {
      encode: (s) => btoa(unescape(encodeURIComponent(s))),
      decode: (s) => decodeURIComponent(escape(atob(s.trim()))),
    },
    rot13: {
      encode: (s) => s.replace(/[a-zA-Z]/g, c =>
        String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < "n" ? 13 : -13))),
      decode: function (s) { return this.encode(s); },
    },
    hex: {
      encode: (s) => Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, "0")).join(" "),
      decode: (s) => new TextDecoder().decode(new Uint8Array(s.trim().split(/\s+|,|-/).filter(Boolean).map(h => parseInt(h, 16)))),
    },
    reverse: {
      encode: (s) => [...s].reverse().join(""),
      decode: function (s) { return this.encode(s); },
    },
  };

  initTed();
  initPrint();
  initAdmin();

  function initTed() {
    const algoEl = document.getElementById("ted-algo");
    const inputEl = document.getElementById("ted-input");
    const outputEl = document.getElementById("ted-output");
    if (!algoEl || !inputEl || !outputEl) return;

    const arrowEl = document.getElementById("ted-arrow");
    let mode = "encode";
    const run = () => {
      const algo = window.TED[algoEl.value];
      if (!algo) return;
      try {
        outputEl.value = inputEl.value ? algo[mode](inputEl.value) : "";
      } catch (err) {
        outputEl.value = "// ERROR: " + (err && err.message ? err.message : err);
      }
    };

    inputEl.addEventListener("input", run);
    algoEl.addEventListener("change", run);
    document.querySelectorAll(".ted__mode .seg").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".ted__mode .seg").forEach((x) => x.classList.remove("is-active"));
        button.classList.add("is-active");
        mode = button.dataset.mode;
        if (arrowEl) arrowEl.textContent = mode === "encode" ? "->" : "<-";
        run();
      });
    });

    document.getElementById("ted-clear")?.addEventListener("click", () => {
      inputEl.value = "";
      outputEl.value = "";
      inputEl.focus();
    });
    document.getElementById("ted-copy")?.addEventListener("click", async (event) => {
      if (!outputEl.value) return;
      await navigator.clipboard.writeText(outputEl.value);
      flash(event.currentTarget, "COPIED");
    });
  }

  function initPrint() {
    const form = document.getElementById("print-form");
    if (!form) return;

    const drop = document.getElementById("drop");
    const fileInput = document.getElementById("print-file");
    const dropSub = document.getElementById("drop-sub");
    const linkInput = document.getElementById("print-link");
    const quoteCard = document.getElementById("quote");
    const contactPanel = document.getElementById("contact-panel");
    const contactForm = document.getElementById("contact-form");
    let lastQuote = null;

    ["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.add("is-drag");
    }));
    ["dragleave", "drop"].forEach((name) => drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.remove("is-drag");
    }));
    drop.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        fileInput.files = event.dataTransfer.files;
        dropSub.textContent = `${file.name} - ${formatBytes(file.size)}`;
      }
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) dropSub.textContent = `${file.name} - ${formatBytes(file.size)}`;
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      const file = fileInput.files?.[0];
      const link = linkInput.value.trim();
      if (!file && !link) return flash(button, "NEED FILE OR LINK");

      setBusy(button, true, "CALCULATING...");
      try {
        const localQuote = await calculateLocalQuote(file, link, document.getElementById("print-material").value, document.getElementById("print-strength").value, document.getElementById("print-detail").value);
        if (!localQuote) {
          flash(button, "INVALID MODEL");
          return;
        }

        lastQuote = {
          request_id: `LOCAL-${Date.now()}`,
          model_name: localQuote.filename || "Local model",
          source_link: localQuote.sourceLink || link,
          manual_required: false,
          storage: {},
          quote: localQuote.quote,
        };

        quoteCard.hidden = false;
        renderQuote(lastQuote);
        text("quote-note", "Local estimate complete. No data was sent to the server.");
        document.getElementById("quote-continue")?.removeAttribute("disabled");
        contactPanel.hidden = false;
        quoteCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (err) {
        flash(button, "QUOTE FAILED");
        console.error(err);
      } finally {
        setBusy(button, false);
      }
    });

    document.getElementById("quote-continue")?.addEventListener("click", () => {
      contactPanel.hidden = false;
      contactPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    contactForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!lastQuote) return;
      const button = event.submitter;
      setBusy(button, true, "SAVED");
      await new Promise((resolve) => setTimeout(resolve, 200));
      document.getElementById("contact-status").textContent = "Request recorded locally. No network request was made.";
      button.disabled = true;
      setBusy(button, false);
    });
  }

  function renderQuote(res) {
    const manual = !!res.manual_required;
    const quote = res.quote || {};
    text("quote-price", manual ? "MANUAL" : `€${Number(quote.price).toFixed(2)}`);
    text("q-model", res.model_name || res.request_id);
    text("q-mat", quote.material || document.getElementById("print-material").value);
    text("q-infill", quote.strength || document.getElementById("print-strength").selectedOptions[0].textContent);
    text("q-quality", quote.detail || document.getElementById("print-detail").selectedOptions[0].textContent);
    text("q-time", quote.time || "Manual");
    text("q-weight", quote.weight_g ? `${quote.weight_g} g` : "Manual");
    text("q-surface", quote.surface_cm2 ? `${quote.surface_cm2} cm²` : "-");
    text("q-volume", quote.volume_cm3 ? `${quote.volume_cm3} cm³` : "-");
    text("quote-note", manual ? res.message : "This is an estimate from the model surface and volume. Continue to send contact details for review.");
  }

  function initAdmin() {
    const login = document.getElementById("admin-login");
    const list = document.getElementById("admin-list");
    if (!login || !list) return;

    login.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!functionsBase) return;
      const password = new FormData(login).get("password");
      const res = await fetch(`${functionsBase}/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(anonKey ? { apikey: anonKey } : {}) },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) return text("admin-status", "Wrong password or function settings.");
      const data = await res.json();
      sessionStorage.setItem("seppie_admin_token", data.token);
      text("admin-status", "Logged in.");
      await loadAdmin();
    });

    async function loadAdmin() {
      const token = sessionStorage.getItem("seppie_admin_token");
      if (!token) return;
      const res = await fetch(`${functionsBase}/admin`, {
        headers: { Authorization: `Bearer ${token}`, ...(anonKey ? { apikey: anonKey } : {}) },
      });
      if (!res.ok) return text("admin-status", "Admin session expired.");
      const data = await res.json();
      list.innerHTML = "";
      data.requests.forEach((request) => {
        const item = document.createElement("article");
        item.className = "admin-item";
        item.innerHTML = `<strong>${escapeHtml(request.name)}</strong><span>${escapeHtml(request.phone)}</span><span>${escapeHtml(request.status)}</span><code>${escapeHtml(request.id)}</code>`;
        list.appendChild(item);
      });
    }

    loadAdmin();
  }

  async function callFunction(path, body) {
    const res = await fetch(`${functionsBase}${path}`, {
      method: "POST",
      headers: anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {},
      body,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function round(value, digits = 2) {
    return Number(Number(value).toFixed(digits));
  }

  function formatMinutes(minutes) {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hrs ? `${hrs}h ${mins}m` : `${mins}m`;
  }

  function text(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function flash(el, value) {
    if (!el) return;
    const old = el.textContent;
    el.textContent = value;
    setTimeout(() => { el.textContent = old; }, 1300);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.oldText = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.oldText || button.textContent;
      button.disabled = false;
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
  }

  function extension(name) {
    return String(name || "").split(/[?#]/)[0].split(".").pop().toLowerCase();
  }
})();
