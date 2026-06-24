/* ============================================================
   デッキ構築
============================================================ */
const deck = document.getElementById('deck');
const dotsNav = document.getElementById('dots');

/* ── 表紙カード ── */
const cover = document.createElement('section');
cover.className = 'card cover';
cover.innerHTML = `
  <h1>彼方への手紙</h1>
  <p>マンデープロジェクト ポートフォリオ</p>
  <div class="scroll-hint">SCROLL ↓</div>`;
deck.appendChild(cover);

/* ── 手紙カード ── */
// ctx[letterIndex] = { envelopeEl, contentsEl, renderContents, applyContents, animate, reset }
const ctx = [];

WORKSHOPS.forEach((ws, i) => {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `
    <div class="envelope" data-letter="${i}">
      <img class="layer-03" src="assets/envelope03.webp" alt="">
      <div class="contents-clip"><div class="contents"></div></div>
      <canvas class="layer-02 frame2" width="950" height="1080"></canvas>
      <canvas class="layer-01 frame1" width="950" height="1080"></canvas>
    </div>
    <div class="label">
      <div class="no">LETTER ${String(i + 1).padStart(2, '0')} / 09</div>
      <div class="date">${ws.date}</div>
      <div class="title">${ws.title}</div>
    </div>`;
  deck.appendChild(card);

  const envelopeEl = card.querySelector('.envelope');
  const contentsEl = card.querySelector('.contents');
  const frameEl  = card.querySelector('.frame1');        // envelope01+影 (canvas)
  const frameEl2 = card.querySelector('.frame2');        // envelope02+影 (canvas)
  const c1 = frameEl.getContext('2d');
  const c2 = frameEl2.getContext('2d');
  let rafId = null;

  // 中身DOMを letterContents から再生成
  function renderContents() {
    contentsEl.innerHTML = '';
    (letterContents[i] || []).forEach((obj) => {
      const el = document.createElement('div');
      el.className = 'content-obj';
      el.innerHTML = `<img src="${obj.src}" alt="">`;
      if (obj.sticker) {
        // ステッカー風ハイライト（画像の形にマスク）。
        // mask は style属性に直書きするとdataURL内の " で壊れるためDOM APIで設定。
        const sh = document.createElement('div');
        sh.className = 'shine';
        sh.style.webkitMaskImage = `url("${obj.src}")`;
        sh.style.maskImage = `url("${obj.src}")`;
        el.appendChild(sh);
      }
      applyState(el, obj.init);
      contentsEl.appendChild(el);
    });
  }
  // ステッカーのハイライト位置を進捗pで更新（斜めに横切る）
  function applyShine(el, p) {
    const sh = el.querySelector('.shine');
    if (sh) sh.style.backgroundPositionX = (130 - p * 160) + '%';
  }
  // lin: 0=初期, 1=最終 の線形進捗。X/Y 同じイーズインアウト。
  // 位置は init→ctrl→final の2次ベジエ曲線、回転/拡縮は直線補間。
  function applyContents(lin) {
    const p = easeInOut(lin);
    const objs = letterContents[i] || [];
    const els = contentsEl.children;
    for (let k = 0; k < objs.length; k++) {
      if (!els[k]) continue;
      const a = objs[k].init, b = objs[k].final;
      const c = objs[k].ctrl || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      applyState(els[k], {
        x: qbez(a.x, c.x, b.x, p),
        y: qbez(a.y, c.y, b.y, p),
        rot: lerp(a.rot, b.rot, p),
        scale: lerp(a.scale, b.scale, p)
      });
    }
  }
  // ステッカーのハイライトを進捗spで一括更新（オブジェクト移動とは別タイムライン）
  function applyAllShine(sp) {
    const objs = letterContents[i] || [];
    const els = contentsEl.children;
    for (let k = 0; k < objs.length; k++) {
      if (els[k] && objs[k].sticker) applyShine(els[k], sp);
    }
  }

  // 事前デコード済みビットマップを canvas へ描画（再デコード無し＝高速）。
  // bm は ImageBitmap か、フォールバック時は <img>。バッファは素材実寸に合わせる。
  function drawFrame(canvas, c2d, bm) {
    if (!bm) return; // まだデコード前なら何もしない（loadFrames 完了後に再描画される）
    const w = bm.naturalWidth || bm.width, h = bm.naturalHeight || bm.height;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    c2d.clearRect(0, 0, w, h);
    c2d.drawImage(bm, 0, 0);
  }
  // 封筒の表示を指定フレームに（影は焼き込み済みなので2レイヤーのみ）
  function setEnv(frame) {
    drawFrame(frameEl,  c1, FRAME_BITMAPS.e1[frame]); // envelope01+影
    drawFrame(frameEl2, c2, FRAME_BITMAPS.e2[frame]); // envelope02+影
    frameEl.classList.toggle('is-back', frame >= BACK_FRAME);
  }
  const redrawCurrent = () => setEnv(frameAt(env.v));
  const frameAt = (p) => Math.min(TOTAL_FRAMES, Math.max(1,
    Math.round(1 + p * (TOTAL_FRAMES - 1))));

  // 封筒(env)と中身(con)を独立したチャンネルとして、現在値→目標値へ補間。
  // 途中でマウスが出入りしても“今の状態”から続けるので途切れない。
  // v: 0=閉/初期, 1=開/最終（線形）。delayLeft: 動き出すまでの待ち時間(ms)。
  const env = { v: 0, target: 0, delayLeft: 0, dur: DURATION };
  const con = { v: 0, target: 0, delayLeft: 0, dur: CONTENT_DURATION };
  const shn = { v: 0, target: 0, delayLeft: 0, dur: SHINE_DURATION }; // ハイライト用
  let lastT = 0;
  let held = false; // ギャラリー展開中: 封筒を開いたまま保持（ホバーが外れても閉じない）
  let openWaiters = []; // 「完全に開ききった」時点で一度だけ呼ぶコールバック群

  function tick(now) {
    const dt = now - lastT; lastT = now;
    [env, con, shn].forEach((ch) => {
      if (ch.delayLeft > 0) { ch.delayLeft = Math.max(0, ch.delayLeft - dt); return; }
      if (ch.v !== ch.target) {
        const dir = ch.target > ch.v ? 1 : -1;
        ch.v += dir * (dt / ch.dur);
        if ((dir > 0 && ch.v > ch.target) || (dir < 0 && ch.v < ch.target)) ch.v = ch.target;
      }
    });
    setEnv(frameAt(env.v));
    applyContents(con.v);
    applyAllShine(shn.v);
    const busy = env.v !== env.target || con.v !== con.target || shn.v !== shn.target ||
                 env.delayLeft > 0 || con.delayLeft > 0 || shn.delayLeft > 0;
    rafId = busy ? requestAnimationFrame(tick) : null;
    if (!busy) {
      envelopeEl.classList.remove('playing'); // 再生終了
      // 完全に開ききった状態で停止したら、待機中のコールバックを実行
      if (openWaiters.length && isOpen()) {
        const ws = openWaiters; openWaiters = [];
        ws.forEach((fn) => fn());
      }
    }
  }
  function ensureLoop() {
    envelopeEl.classList.add('playing'); // 再生中（デバッグ時 envelope01 を表示）
    if (rafId == null) { lastT = performance.now(); rafId = requestAnimationFrame(tick); }
  }

  // 開く: 封筒すぐ / 中身は封筒が動き出してから300ms後に動き出す
  // cb を渡すと、開封アニメーションが完全に終わった時点で一度だけ呼ばれる
  function open(cb) {
    env.target = 1; env.delayLeft = 0;
    con.target = 1; con.delayLeft = SEQ_DELAY;
    shn.target = 1; shn.delayLeft = SEQ_DELAY;
    if (cb) openWaiters.push(cb);
    ensureLoop();
  }
  // 全チャンネルが開放(=1)で停止しているか（遅延待ちも無い完全な開封状態）
  function isOpen() {
    return env.v === 1 && con.v === 1 && shn.v === 1 &&
           env.target === 1 && con.target === 1 && shn.target === 1 &&
           env.delayLeft === 0 && con.delayLeft === 0 && shn.delayLeft === 0;
  }
  // 閉じる: 中身すぐ収納 / 封筒は中身が動き出してから300ms後に閉じる
  function close() {
    con.target = 0; con.delayLeft = 0;
    shn.target = 0; shn.delayLeft = 0;
    env.target = 0; env.delayLeft = SEQ_DELAY;
    ensureLoop();
  }
  const animate = (reverse = false) => (reverse ? close() : open());
  // ギャラリー展開中の封筒保持。holdOpen=開いて固定 / releaseClose=ホバー解除時と同じ閉じ。
  function holdOpen() { held = true; open(); }
  // 開いたまま固定し、開封アニメーションが終わったら cb を呼ぶ（ホバー中クリック対策）
  function holdOpenThen(cb) { held = true; open(cb); }
  function releaseClose() { held = false; close(); }
  function reset() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    envelopeEl.classList.remove('playing');
    openWaiters = [];
    env.v = env.target = 0; env.delayLeft = 0;
    con.v = con.target = 0; con.delayLeft = 0;
    shn.v = shn.target = 0; shn.delayLeft = 0;
    setEnv(1); // フレーム1(閉じた状態)を描画。is-back もここで解除される
    renderContents();
    applyContents(0);
  }

  renderContents();
  applyContents(0);
  setEnv(1); // 初期フレーム。デコード前なら空のまま → loadFrames 完了時に再描画

  // 通常モードのみ操作を割り当て
  if (!DEBUG) {
    if (window.matchMedia('(hover: hover)').matches) {
      // PC等: ホバーで開封 / クリックで横スクロールギャラリーへ展開（再クリックで閉）
      envelopeEl.addEventListener('mouseenter', () => { if (!held) open(); });
      envelopeEl.addEventListener('mouseleave', () => { if (!held) close(); });
      envelopeEl.addEventListener('click', () => {
        if (galleryOpen) closeGallery(); else openGallery(i);
      });
    } else {
      // スマホ等(ホバー非対応): 1タップで開封 / 開封済みなら次タップで展開
      envelopeEl.addEventListener('click', () => {
        if (galleryOpen) { closeGallery(); return; }
        if (env.target === 1) openGallery(i);
        else open();
      });
    }
  }

  ctx.push({ cardEl: card, envelopeEl, contentsEl, renderContents, applyContents, animate, reset, holdOpen, holdOpenThen, releaseClose, isOpen, redrawCurrent });
});

// フレームのデコードを開始。表示実寸×DPRに合わせて縮小し、メモリを節約する。
// clientWidth の読み取りでレイアウトが確定するので rAF を待たず同期で測れる
// （rAF は非表示タブでは発火しないため、デコード開始を rAF に依存させない）。
{
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const dispW = (ctx[0] && ctx[0].envelopeEl.clientWidth) || 520;
  const redrawAll = () => ctx.forEach((C) => C.redrawCurrent());
  // 先頭フレーム確定時（onFirst）と全フレーム確定時（then）に描き直す
  loadFrames(Math.round(dispW * dpr), redrawAll).then(redrawAll);
}

/* ───── ドットナビ生成 ───── */
const cards = Array.from(deck.querySelectorAll('.card'));
cards.forEach((_, i) => {
  const b = document.createElement('button');
  b.setAttribute('aria-label', i === 0 ? '表紙' : `手紙 ${i}`);
  b.addEventListener('click', () => goTo(i));
  dotsNav.appendChild(b);
});
const dots = Array.from(dotsNav.children);

/* ───── 現在カードの管理 ───── */
let current = 0;
function setActive(idx) {
  if (idx === current) return;
  if (current > 0 && ctx[current - 1]) ctx[current - 1].reset();
  current = idx;
  dots.forEach((d, i) => d.classList.toggle('active', i === idx));
}
dots[0].classList.add('active');

const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(cards.indexOf(e.target));
  });
}, { root: deck, threshold: [0.6] });
cards.forEach((c) => io.observe(c));

/* ───── 1スクロール＝1枚 切り替え ───── */
function goTo(idx) {
  idx = Math.max(0, Math.min(cards.length - 1, idx));
  cards[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

let wheelLock = false;
deck.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (wheelLock || Math.abs(e.deltaY) < 8) return;
  wheelLock = true;
  goTo(current + (e.deltaY > 0 ? 1 : -1));
  setTimeout(() => { wheelLock = false; }, 700);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (galleryOpen) return; // ギャラリー展開中はデッキ移動を止める
  if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); goTo(current + 1); }
  if (e.key === 'ArrowUp'   || e.key === 'PageUp')   { e.preventDefault(); goTo(current - 1); }
});
