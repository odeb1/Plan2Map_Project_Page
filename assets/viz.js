/* Plan2Map — interactive pipeline flow + MINIMA-LoFTR slider */
(() => {
  'use strict';

  // ───────────── PIPELINE FLOW: clean strip + per-stage input→output ─────────────
  const A = 'assets/';
  const STAGES = [
    { n:1, label:'Reader', color:'blue',
      desc:'A single VLM call reads the whole PDF and returns structured spatial evidence &mdash; site address, postcodes, OS grid refs, road and place names, and whether the application covers a whole district or a single site. It also identifies which page holds the boundary map, which is then north-aligned.',
      in:{pages:[A+'loddon_pdf_p1.png', A+'loddon_pdf_p2.png'], cap:'Source PDF'},
      out:{img:A+'loddon_map.png', cap:'Rendered map page'},
      kv:[['model','Gemini 3 Flash'],['output','Structured information'],['budget','1 request']] },
    { n:2, label:'Locate', color:'green',
      desc:'From the reader&rsquo;s structured information and the map image, the Locate sub-agent produces a rough initial estimate of where the site is &mdash; a centre point plus a confidence radius &sigma; &asymp; 400 m. It queries OS Open Names for anchors like places or road names. The green box on the OS Zoomstack tiles is the region MINIMA then does sliding-window refinement over to find the exact position of the planning site.',
      in:{locinfo:{img:A+'loddon_map.png', rows:[['Site','land lying to the east of Market Place, Loddon'],['Postcode','NR15 2XE'],['Roads','Market Place &middot; High Street'],['Places','Loddon &middot; Holy Trinity Church']]}, cap:'Map page + PDFInfo'},
      out:{img:A+'loddon_locate_search.png', cap:'MINIMA search region &middot; OS Zoomstack'},
      kv:[['inputs','PDFInfo + map image'],['output','lat, lon + &sigma;'],['here','Loddon &middot; &sigma; &asymp; 400 m']] },
    { n:3, label:'Map registration', color:'amber', slider:true,
      desc:'The zoom is read off the map&rsquo;s printed scale (1:2500 here) and the map is slid across the OS basemap tiles at that zoom and its neighbours. At each window MINIMA-LoFTR proposes matches and RANSAC fits a rotation&ndash;scale&ndash;translation, scored by how many matches survive; only the best window per zoom is kept. Those few survivors are re-ranked by how evenly their matches spread across the map and by whether road names read from the document show up in the OS road network nearby. The top one is committed.',
      in:{img:A+'loddon_map.png', cap:'Planning map'},
      out:{img:A+'slider_data/tile_canvas.png', cap:'OS basemap &middot; 110 windows'},
      kv:[['zoom','from 1:2500 scale'],['matcher','MINIMA-LoFTR + RANSAC'],['re-rank','match spread &middot; road names']] },
    { n:4, label:'SAM 3 + LoRA', color:'violet',
      desc:'Boundary segmentation: SAM 3 prompted with the text query &ldquo;planning boundary&rdquo; and fine-tuned with LoRA, so it returns the application boundary drawn on the planning map.',
      in:{img:A+'loddon_map.png', cap:'Planning map'},
      out:{img:A+'loddon_sam_mask.png', cap:'Boundary mask'},
      kv:[['backbone','facebook/sam3'],['pixel IoU','0.989']] },
    { n:5, label:'Projection', color:'slate',
      desc:'RANSAC fits an affine transform to the MINIMA matches; the SAM 3 mask is projected through it into WGS84. Here the prediction (red) lands on the ground-truth boundary (green) at IoU 0.94.',
      in:{img:A+'loddon_sam_mask.png', cap:'Boundary mask + affine'},
      out:{img:A+'loddon_pred_vs_gt.png', cap:'Prediction vs ground truth'},
      kv:[['transform','affine &rarr; WGS84'],['output','GeoJSON'],['IoU','0.94']] },
  ];

  function ioCard(io, kind){
    if (io.pages) return `<figure class="flow-io flow-io-${kind} flow-io-pages"><div class="pdf-pages"><img class="pg pg-back" src="${io.pages[0]}" alt="" loading="lazy"><img class="pg pg-front" src="${io.pages[1]}" alt="" loading="lazy"></div><figcaption>${io.cap}</figcaption></figure>`;
    if (io.locinfo) return `<figure class="flow-io flow-io-${kind} flow-io-locin"><img class="locin-map" src="${io.locinfo.img}" alt="" loading="lazy"><dl class="pdfinfo">${io.locinfo.rows.map(([k,val])=>`<div><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl><figcaption>${io.cap}</figcaption></figure>`;
    if (io.area) return `<figure class="flow-io flow-io-${kind} flow-io-area"><svg viewBox="0 0 150 120" class="area-svg"><rect x="1" y="1" width="148" height="118" rx="8" fill="var(--cream)" stroke="var(--line)"/><path d="M24 66 Q18 46 38 42 Q44 24 68 30 Q94 24 102 44 Q126 48 120 70 Q126 94 100 96 Q88 112 64 104 Q38 108 32 88 Q16 86 24 66 Z" fill="rgba(34,106,74,0.16)" stroke="var(--green-ink)" stroke-width="1.5" stroke-dasharray="4 4"/><circle cx="70" cy="67" r="3" fill="var(--green-ink)"/></svg><figcaption>${io.cap}</figcaption></figure>`;
    if (io.img) return `<figure class="flow-io flow-io-${kind}"><img src="${io.img}" alt="${io.cap}" loading="lazy"><figcaption>${io.cap}</figcaption></figure>`;
    return `<figure class="flow-io flow-io-${kind} flow-io-text"><div class="flow-io-chip">${io.cap}</div></figure>`;
  }

  function applyStage(idx){
    const st = STAGES[idx]; if (!st) return;
    document.querySelectorAll('.flow-chip').forEach((c,i)=>c.classList.toggle('is-active', i===idx));
    const det = document.getElementById('stageDetail');
    if (det){
      if (st.slider){
        det.style.display = 'none';        // Map registration: show only the slider below
      } else {
        det.style.display = '';
        const kv = st.kv.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('');
        det.className = 'stage-detail flow-detail color-'+st.color;
        det.innerHTML =
          ioCard(st.in,'in') +
          '<div class="flow-arrow" aria-hidden="true">&rarr;</div>' +
          '<div class="flow-mid"><div class="flow-mid-tag">Stage '+st.n+'</div><h4>'+st.label+'</h4><p>'+st.desc+'</p><dl class="stage-kv">'+kv+'</dl></div>' +
          '<div class="flow-arrow" aria-hidden="true">&rarr;</div>' +
          ioCard(st.out,'out');
      }
    }
    const m = document.getElementById('matcherReveal');
    if (m) m.classList.toggle('is-open', !!st.slider);
  }

  function renderFlow(){
    const host = document.getElementById('pipelineFlow'); if (!host) return;
    host.innerHTML = STAGES.map((st,i)=>
      '<button class="flow-chip color-'+st.color+'" data-stage="'+i+'" type="button"><span class="flow-n">'+st.n+'</span>'+st.label+'</button>'
      + (i<STAGES.length-1 ? '<span class="flow-sep" aria-hidden="true">&rarr;</span>' : '')
    ).join('');
    host.querySelectorAll('.flow-chip').forEach((c,i)=>c.addEventListener('click', ()=>applyStage(i)));
    applyStage(0);
  }


  const SLIDE = {
    // Geometry (filled from windows.json)
    canvasW: 0, canvasH: 0,
    mapW: 0, mapH: 0,
    windows: [],            // real list from JSON
    bestIdx: 0,
    bestWindow: null,       // {x, y, w, h, n_inliers, mkpts0, mkpts1, mconf, inlier_mask}
    zoom: 17,
    // DOM
    mapOverlay: null,       // SVG over left panel
    tilesOverlay: null,     // SVG over right panel
    corrOverlay: null,      // SVG spanning both panels
    mapImg: null,
    tilesImg: null,
    // Animation state
    cursor: 0,
    playing: false,
    timer: null,
    bestSoFar: 0,
    corrShown: false,
  };

  async function loadSliderData() {
    try {
      const r = await fetch('assets/slider_data/windows.json', { cache: 'no-store' });
      if (!r.ok) throw new Error(`status ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn('slider data fetch failed:', e);
      return null;
    }
  }

  function tierFor(n) {
    if (n >= 100) return 'strong';
    if (n >= 50)  return 'ok';
    if (n >= 25)  return 'weak';
    return 'toow';
  }
  function tierColor(n) {
    switch (tierFor(n)) {
      case 'strong': return '#236a4a';
      case 'ok':     return '#83560e';
      case 'weak':   return '#b8860b';
      case 'toow':   return '#aa3030';
    }
  }

  function setSvgViewBox(svg, w, h) {
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  function renderSlideOverlay() {
    if (!SLIDE.tilesOverlay || !SLIDE.windows.length) return;
    const p = SLIDE.windows[SLIDE.cursor];
    if (!p) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    const ov = SLIDE.tilesOverlay;
    const isBest = SLIDE.cursor === SLIDE.bestIdx;

    while (ov.firstChild) ov.removeChild(ov.firstChild);

    // Trail of visited windows (subtle outlines)
    for (let i = 0; i < SLIDE.cursor; i++) {
      const prev = SLIDE.windows[i];
      const trail = document.createElementNS(svgNS, 'rect');
      trail.setAttribute('x', prev.x);
      trail.setAttribute('y', prev.y);
      trail.setAttribute('width', prev.w);
      trail.setAttribute('height', prev.h);
      trail.setAttribute('fill', 'none');
      trail.setAttribute('stroke', tierColor(prev.n_inliers));
      trail.setAttribute('stroke-opacity', '0.10');
      trail.setAttribute('stroke-width', '2');
      trail.setAttribute('rx', '4');
      ov.appendChild(trail);
    }

    // Active window
    const stroke = isBest ? '#d4a017' : tierColor(p.n_inliers);
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', p.x);
    rect.setAttribute('y', p.y);
    rect.setAttribute('width', p.w);
    rect.setAttribute('height', p.h);
    rect.setAttribute('fill', 'rgba(0,0,0,0)');
    rect.setAttribute('stroke', stroke);
    rect.setAttribute('stroke-width', isBest ? '16' : '10');
    rect.setAttribute('rx', '6');
    if (isBest) {
      rect.setAttribute('filter', 'drop-shadow(0 0 30px rgba(212, 160, 23, 0.85))');
    }
    ov.appendChild(rect);

    // Inlier badge
    const badgeW = 220, badgeH = 60;
    const badgeBg = document.createElementNS(svgNS, 'rect');
    badgeBg.setAttribute('x', p.x);
    badgeBg.setAttribute('y', Math.max(0, p.y - badgeH - 8));
    badgeBg.setAttribute('width', badgeW);
    badgeBg.setAttribute('height', badgeH);
    badgeBg.setAttribute('rx', '10');
    badgeBg.setAttribute('fill', stroke);
    ov.appendChild(badgeBg);

    const badgeText = document.createElementNS(svgNS, 'text');
    badgeText.setAttribute('x', p.x + 14);
    badgeText.setAttribute('y', Math.max(35, p.y - badgeH + 38));
    badgeText.setAttribute('fill', '#fff');
    badgeText.setAttribute('font-family', 'JetBrains Mono, ui-monospace, monospace');
    badgeText.setAttribute('font-size', '32');
    badgeText.setAttribute('font-weight', '700');
    badgeText.textContent = isBest ? `BEST \u00b7 ${p.n_inliers}` : `inliers ${p.n_inliers}`;
    ov.appendChild(badgeText);
  }

  function updateReadouts() {
    const p = SLIDE.windows[SLIDE.cursor];
    if (!p) return;
    SLIDE.bestSoFar = Math.max(SLIDE.bestSoFar, p.n_inliers);

    const win    = document.getElementById('rdWindow');
    const zoom   = document.getElementById('rdZoom');
    const inl    = document.getElementById('rdInliers');
    const best   = document.getElementById('rdBest');
    if (win)   win.textContent   = `${SLIDE.cursor + 1} / ${SLIDE.windows.length}`;
    if (zoom)  zoom.textContent  = `z${SLIDE.zoom}`;
    if (inl) {
      inl.textContent = String(p.n_inliers);
      inl.classList.remove('toow', 'weak', 'ok', 'strong');
      inl.classList.add(tierFor(p.n_inliers));
    }
    if (best)  best.textContent  = String(SLIDE.bestSoFar);
  }

  function slideStep() {
    if (SLIDE.cursor < SLIDE.windows.length - 1) {
      SLIDE.cursor++;
    } else {
      SLIDE.cursor = SLIDE.bestIdx;
    }
    renderSlideOverlay();
    updateReadouts();
    SLIDE.corrShown = true;
    renderCorrespondences();
  }

  function slidePlay() {
    if (SLIDE.playing) return;
    SLIDE.playing = true;
    const playBtn = document.getElementById('slidePlay');
    if (playBtn) playBtn.textContent = '⏸ Pause';
    SLIDE.corrShown = true;
    renderCorrespondences();
    SLIDE.timer = setInterval(() => {
      if (SLIDE.cursor >= SLIDE.windows.length - 1) {
        SLIDE.cursor = SLIDE.bestIdx;
        renderSlideOverlay();
        updateReadouts();
        renderCorrespondences();
        slidePause();
        return;
      }
      slideStep();
    }, 110);
  }

  function slidePause() {
    SLIDE.playing = false;
    if (SLIDE.timer) { clearInterval(SLIDE.timer); SLIDE.timer = null; }
    const playBtn = document.getElementById('slidePlay');
    if (playBtn) playBtn.textContent = '▶ Play';
  }

  function slideReset() {
    slidePause();
    SLIDE.cursor = 0;
    SLIDE.bestSoFar = 0;
    SLIDE.corrShown = false;
    clearCorrespondences();
    renderSlideOverlay();
    updateReadouts();
  }

  // ── Correspondence visualisation ────────────────────────────────────────

  function clearCorrespondences() {
    [SLIDE.mapOverlay, SLIDE.corrOverlay].forEach(o => {
      if (!o) return;
      // Leave only the tiles-overlay alone (it carries the window box).
      // Clear only the corr/map overlays.
      while (o.firstChild) o.removeChild(o.firstChild);
    });
  }

  /** Map a keypoint (image-pixel) to viewport (CSS-pixel) coords on a panel image. */
  function imgPxToViewport(img, ix, iy) {
    const r = img.getBoundingClientRect();
    const sx = r.width  / img.naturalWidth;
    const sy = r.height / img.naturalHeight;
    return { x: r.left + ix * sx, y: r.top + iy * sy };
  }

  function renderCorrespondences() {
    const corr = SLIDE.corrOverlay;
    const stage = document.querySelector('.slider-stage');
    if (!corr || !stage) return;
    const sr = stage.getBoundingClientRect();
    corr.setAttribute('viewBox', `0 0 ${sr.width} ${sr.height}`);
    corr.setAttribute('width',  sr.width);
    corr.setAttribute('height', sr.height);

    // Clear the previous window's lines first, so advancing to a window with
    // few/no matches removes the old ones before drawing the new.
    while (corr.firstChild) corr.removeChild(corr.firstChild);
    const mapOv = SLIDE.mapOverlay;
    if (mapOv) while (mapOv.firstChild) mapOv.removeChild(mapOv.firstChild);

    // Correspondences for the CURRENT window — every window carries its own.
    const bw = SLIDE.windows[SLIDE.cursor];
    if (!bw) return;
    const mkpts0 = bw.mkpts0 || [];
    const mkpts1 = bw.mkpts1 || [];
    const inl    = bw.inlier_mask || [];
    if (mkpts0.length === 0) return;
    const svgNS = 'http://www.w3.org/2000/svg';

    // Draw outliers first, inliers (bright) on top
    const order = [];
    for (let i = 0; i < mkpts0.length; i++) if (inl[i] === 0) order.push(i);
    for (let i = 0; i < mkpts0.length; i++) if (inl[i] === 1) order.push(i);

    const mapImg = SLIDE.mapImg;
    const tilesImg = SLIDE.tilesImg;
    if (!mapImg || !tilesImg) return;

    for (const i of order) {
      const isInlier = inl[i] === 1;
      const opacity = isInlier ? 0.85 : 0.18;
      const colour  = isInlier ? '#236a4a' : '#5e6b76';
      const radius  = isInlier ? 4 : 2.5;

      // Left endpoint: keypoint in planning map
      const [mx, my] = mkpts0[i];
      const L = imgPxToViewport(mapImg, mx, my);

      // Right endpoint: keypoint in tile canvas = window-relative + window offset
      const [tx, ty] = mkpts1[i];
      const T = imgPxToViewport(tilesImg, tx + bw.x, ty + bw.y);

      // Stage-relative coords
      const Lx = L.x - sr.left, Ly = L.y - sr.top;
      const Tx = T.x - sr.left, Ty = T.y - sr.top;

      // Connecting line on the top-level overlay
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', Lx); line.setAttribute('y1', Ly);
      line.setAttribute('x2', Tx); line.setAttribute('y2', Ty);
      line.setAttribute('stroke', colour);
      line.setAttribute('stroke-width', isInlier ? '1.2' : '0.7');
      line.setAttribute('stroke-opacity', String(opacity));
      corr.appendChild(line);

      // Dots on each end
      [[Lx, Ly], [Tx, Ty]].forEach(([cx, cy]) => {
        const c = document.createElementNS(svgNS, 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', cy);
        c.setAttribute('r', radius);
        c.setAttribute('fill', colour);
        c.setAttribute('fill-opacity', String(opacity));
        corr.appendChild(c);
      });
    }
  }

  async function initSlider() {
    SLIDE.mapOverlay   = document.getElementById('slideMapOverlay');
    SLIDE.tilesOverlay = document.getElementById('slideTilesOverlay');
    SLIDE.corrOverlay  = document.getElementById('slideCorrOverlay');
    SLIDE.mapImg       = document.getElementById('slideMapImg');
    SLIDE.tilesImg     = document.getElementById('slideTilesImg');
    if (!SLIDE.tilesOverlay) return;

    // Fetch real data
    const data = await loadSliderData();
    if (!data) {
      console.warn('slider running with no data');
      return;
    }

    SLIDE.canvasW   = data.canvas_w;
    SLIDE.canvasH   = data.canvas_h;
    SLIDE.mapW      = data.map_w;
    SLIDE.mapH      = data.map_h;
    SLIDE.windows   = data.windows;
    SLIDE.zoom      = data.zoom;
    SLIDE.bestWindow = data.best_window;
    SLIDE.bestIdx   = data.windows.reduce(
      (best, w, i) => (w.n_inliers > data.windows[best].n_inliers ? i : best), 0,
    );

    // Set viewBoxes so the SVG overlays use image-pixel coords
    setSvgViewBox(SLIDE.tilesOverlay, SLIDE.canvasW, SLIDE.canvasH);
    setSvgViewBox(SLIDE.mapOverlay,   SLIDE.mapW,    SLIDE.mapH);

    // Wire buttons
    document.getElementById('slidePlay')?.addEventListener('click',
      () => SLIDE.playing ? slidePause() : slidePlay());
    document.getElementById('slideStep')?.addEventListener('click',
      () => { slidePause(); slideStep(); });
    document.getElementById('slideReset')?.addEventListener('click',
      () => slideReset());

    // Re-render the current window's correspondences on resize.
    window.addEventListener('resize', () => {
      if (SLIDE.corrShown) renderCorrespondences();
    });

    slideReset();
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderFlow();
    initSlider();
  });

})();
