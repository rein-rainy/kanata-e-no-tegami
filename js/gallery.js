/* ============================================================
   横スクロールギャラリー展開
   手紙をクリック → その手紙の中身が全て
     (1) 垂直に上昇 → (2) 最前面へ移動し中央へ → (3) 横スクロール状に下降
   同時に背景（封筒・デッキ）をブラー＆暗転。
   並び順 / スケールは各オブジェクトの gallery:{order,scale}（DEBUGで編集）。
============================================================ */
const gallery = document.createElement('div');
gallery.className = 'gallery';
gallery.innerHTML =
  '<div class="gallery-backdrop"></div>' +
  '<div class="gallery-scroll"><div class="gallery-track"></div></div>' +
  '<nav class="gallery-dots" aria-label="オブジェクトナビゲーション"></nav>' +
  '<button class="gallery-close" aria-label="閉じる">×</button>';
document.body.appendChild(gallery);
const galleryScroll   = gallery.querySelector('.gallery-scroll');
const galleryTrack    = gallery.querySelector('.gallery-track');
const galleryBackdrop = gallery.querySelector('.gallery-backdrop');
const galleryDots     = gallery.querySelector('.gallery-dots');
const galleryCloseBtn = gallery.querySelector('.gallery-close');

let galleryOpen = false, galleryLetter = -1, galleryBusy = false;

// gallery 設定（並び順・スケール）の取得
const galOrder = (o, idx) => (o.gallery && Number.isFinite(o.gallery.order)) ? o.gallery.order : idx;
const galScale = (o) => (o.gallery && o.gallery.scale > 0) ? o.gallery.scale : 1;
// [{o, idx}] を gallery 並び順でソート（idx は元配列上の位置）
function galSorted(objs) {
  return objs.map((o, idx) => ({ o, idx }))
    .sort((a, b) => (galOrder(a.o, a.idx) - galOrder(b.o, b.idx)) || (a.idx - b.idx));
}
const LIFT_BASE = 64; // 上昇量の基礎(px)
// 2フェーズの所要時間。開封: 上昇→（最前面化＋暗転開始）→中央へ。閉: 中央→上昇→（元レイヤーへ）→収納。
const RISE_MS = 340, CENTER_MS = 600;  // 開封
const UP_MS = 420, DOWN_MS = 360;      // 閉じる

// 中身(content-obj)の“今の見た目”（中心位置・回転・スケール）に、ギャラリー項目を
// 重ねるための差分変換を返す。回転・スケールも含めるので、ホバーで設定した初期/最終
// 状態の見た目から途切れずに繋がる。
function flipMatch(srcEl, itemEl) {
  const sRect = srcEl.getBoundingClientRect();
  const tRect = itemEl.getBoundingClientRect();
  const tf = getComputedStyle(srcEl).transform;
  const m = (tf && tf !== 'none') ? new DOMMatrix(tf) : new DOMMatrix();
  const s   = Math.hypot(m.a, m.b) || 1;               // 現在のスケール
  const rot = Math.atan2(m.b, m.a) * 180 / Math.PI;    // 現在の回転(deg)
  const dx = (sRect.left + sRect.width  / 2) - (tRect.left + tRect.width  / 2);
  const dy = (sRect.top  + sRect.height / 2) - (tRect.top  + tRect.height / 2);
  const scale = (srcEl.offsetWidth * s) / (itemEl.offsetWidth || 1);
  return { dx, dy, scale, rot, h: sRect.height };
}

// コンテナ内の全imgのサイズ確定（読み込み完了）を待つ。
// カウントとリスナー登録を同一パスで行い、判定〜登録の隙間で complete に
// なった画像が取りこぼされて pending が0に戻らない競合を防ぐ。安全策に上限時間も。
function waitImages(container, cb) {
  let pending = 0, called = false;
  const finish = () => { if (!called) { called = true; cb(); } };
  Array.from(container.querySelectorAll('img')).forEach((im) => {
    if (im.complete) return;
    pending++;
    const done = () => { if (--pending <= 0) finish(); };
    im.addEventListener('load', done, { once: true });
    im.addEventListener('error', done, { once: true });
  });
  if (pending === 0) finish();
  else setTimeout(finish, 1500); // 念のためのフォールバック
}

let galleryLift = 0;   // グループ上昇量(px)。開封で決め、閉じるときも同じ値を使う。
let galleryIndex = 0;  // 横スクロールで中央にあるオブジェクトの番号
// 一度だけ実行（onfinish と フォールバックtimeout の二重発火を防ぐ）
const once = (fn) => { let called = false; return () => { if (!called) { called = true; fn(); } }; };

// k番目のオブジェクトを中央へ（transformの影響を受けないレイアウト基準 offsetLeft で算出）
function galleryCenterIndex(k, smooth) {
  const it = galleryTrack.children[k];
  if (!it) return;
  const target = it.offsetLeft + it.offsetWidth / 2 - galleryScroll.clientWidth / 2;
  galleryScroll.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'instant' });
}
// 縦デッキの goTo と同じ“1つずつ”移動
function galleryGoTo(k) {
  const n = galleryTrack.children.length;
  if (!n) return;
  galleryIndex = Math.max(0, Math.min(n - 1, k));
  galleryCenterIndex(galleryIndex, true);
  updateGalleryDots();
}
// ドットナビ（横向き・中央下）を項目数ぶん生成
function buildGalleryDots(n) {
  galleryDots.innerHTML = '';
  for (let k = 0; k < n; k++) {
    const b = document.createElement('button');
    b.setAttribute('aria-label', `オブジェクト ${k + 1}`);
    b.addEventListener('click', () => galleryGoTo(k));
    galleryDots.appendChild(b);
  }
  updateGalleryDots();
}
// 中央のオブジェクトに対応するドットをアクティブ表示
function updateGalleryDots() {
  Array.from(galleryDots.children)
    .forEach((d, k) => d.classList.toggle('active', k === galleryIndex));
}
// 各ギャラリー項目を「短辺80% × 縮小率」の枠にフィット（拡大・縮小ともアスペクト比維持）
function sizeGalleryItems(ordered) {
  const box = Math.min(window.innerWidth, window.innerHeight) * 0.8;
  ordered.forEach(({ o }, k) => {
    const it = galleryTrack.children[k];
    if (!it) return;
    const img = it.querySelector('img');
    if (!img) return;
    const b = box * galScale(o);
    const ar = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : 1;
    const w = ar >= 1 ? b : b * ar;
    const h = ar >= 1 ? b / ar : b;
    img.style.width = w + 'px';
    img.style.height = h + 'px';
  });
}
// content-obj の「封筒内・最終(open)位置」の rect を config から算出（閉じる時の戻り先）
function contentFinalRect(C, obj) {
  const envRect = C.envelopeEl.getBoundingClientRect();
  return {
    cx: envRect.left + envRect.width  * obj.final.x / 100,
    cy: envRect.top  + envRect.height * obj.final.y / 100,
    w:  envRect.width * 0.5 * (obj.final.scale || 1), // .content-obj は幅50%×scale
    rot: obj.final.rot || 0
  };
}

/* ── スナップ中(中央)のオブジェクトをマウスに合わせて3D傾斜（ステッカーは反射も追従） ──
   参考: https://www.frontend.fyi/tutorials/css-3d-perspective-animations */
const TILT_MAX = 14;  // scale=1(基準)での最大傾き(deg)
const TILT_BOOST_MAX = 2; // 小さいscaleでの傾き倍率の上限
let tiltEl = null;   // 現在傾けている .gi-tilt
let tiltMouse = null, tiltRaf = false;

// ビューポート中央に最も近い（＝スナップ中の）オブジェクト番号
function nearestCenterIndex() {
  const sr = galleryScroll.getBoundingClientRect();
  const cx = sr.left + sr.width / 2;
  let best = -1, bestD = Infinity;
  Array.from(galleryTrack.children).forEach((it, k) => {
    const r = it.getBoundingClientRect();
    const d = Math.abs(r.left + r.width / 2 - cx);
    if (d < bestD) { bestD = d; best = k; }
  });
  return best;
}
function clearTilt(t) { if (t) { t.classList.remove('tilting'); t.style.transform = ''; } }
// カーソルが乗っているオブジェクト（スナップ中かどうかに関わらず）
function itemUnderCursor() {
  return Array.from(galleryTrack.children).find((it) => {
    const r = it.getBoundingClientRect();
    return tiltMouse.x >= r.left && tiltMouse.x <= r.right &&
           tiltMouse.y >= r.top  && tiltMouse.y <= r.bottom;
  }) || null;
}
// px,py は -1〜1（中央=0）。マウス・ジャイロ共通の傾き適用。maxMul=傾き上限の倍率。
function applyTiltTo(it, px, py, maxMul = 1) {
  const t = it && it.querySelector('.gi-tilt');
  if (!t) return;
  if (tiltEl && tiltEl !== t) clearTilt(tiltEl);
  tiltEl = t;
  px = Math.max(-1, Math.min(1, px));
  py = Math.max(-1, Math.min(1, py));
  // デバッグのgallery.scaleが小さいほど傾きを強める（1が基準、上限あり）
  const gs = parseFloat(it.dataset.galScale) || 1;
  const boost = Math.min(TILT_BOOST_MAX, Math.max(1, 1 / gs));
  const tiltMax = TILT_MAX * boost * maxMul;
  t.style.transform = `rotateX(${(-py * tiltMax).toFixed(2)}deg) rotateY(${(px * tiltMax).toFixed(2)}deg)`;
  const glare = t.querySelector('.g-glare');
  if (glare) { // 反射ハイライトを傾き方向へ
    glare.style.setProperty('--gx', ((px * 0.5 + 0.5) * 100).toFixed(1) + '%');
    glare.style.setProperty('--gy', ((py * 0.5 + 0.5) * 100).toFixed(1) + '%');
  }
  t.classList.add('tilting');
}
function tiltFrame() {
  tiltRaf = false;
  if (!galleryOpen || galleryBusy || !tiltMouse) return;
  const it = itemUnderCursor();
  // カーソルがどのオブジェクトにも触れていなければ平らに戻す。
  if (!it || !it.querySelector('.gi-tilt')) { if (tiltEl) { clearTilt(tiltEl); tiltEl = null; } return; }
  const r = it.getBoundingClientRect();
  const px = (tiltMouse.x - (r.left + r.width / 2)) / (r.width / 2);
  const py = (tiltMouse.y - (r.top + r.height / 2)) / (r.height / 2);
  applyTiltTo(it, px, py);
}
galleryScroll.addEventListener('mousemove', (e) => {
  tiltMouse = { x: e.clientX, y: e.clientY };
  if (!tiltRaf) { tiltRaf = true; requestAnimationFrame(tiltFrame); }
});
galleryScroll.addEventListener('mouseleave', () => {
  tiltMouse = null; clearTilt(tiltEl); tiltEl = null;
});

// ── スマホ: 端末のジャイロ(傾き)で中央のオブジェクトを傾ける ──
const GYRO_RANGE = 15;        // この傾き(deg)で最大に到達（小さいほど傾き量が大きい）
let gyroOn = false, gyroBase = null, gyroData = null, gyroRaf = false;
function gyroFrame() {
  gyroRaf = false;
  if (!galleryOpen || galleryBusy || !gyroData) return;
  const it = galleryTrack.children[nearestCenterIndex()];
  if (!it || !it.querySelector('.gi-tilt')) return;
  if (!gyroBase) gyroBase = { beta: gyroData.beta, gamma: gyroData.gamma }; // 開いた時点の姿勢を基準に
  const px = -(gyroData.gamma - gyroBase.gamma) / GYRO_RANGE; // 左右の傾き（ジャイロと逆方向）
  const py = -(gyroData.beta  - gyroBase.beta)  / GYRO_RANGE; // 前後の傾き（ジャイロと逆方向）
  applyTiltTo(it, px, py, 3); // スマホは傾き上限を3倍に
}
function onDeviceOrientation(e) {
  if (e.gamma == null || e.beta == null) return;
  gyroData = { beta: e.beta, gamma: e.gamma };
  if (!gyroRaf) { gyroRaf = true; requestAnimationFrame(gyroFrame); }
}
// 端末傾きセンサーを有効化（iOSは要ユーザー操作での許可）。封筒タップ等から呼ぶ。
function enableGyro() {
  if (gyroOn) return;
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;
  const attach = () => { gyroOn = true; window.addEventListener('deviceorientation', onDeviceOrientation); };
  if (typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((res) => { if (res === 'granted') attach(); }).catch(() => {});
  } else { attach(); }
}
window.enableGyro = enableGyro;
// 自由スクロール(トラックパッド等)でも中央番号を同期。スクロール中は一旦傾きを解除。
let galScrollSettle;
galleryScroll.addEventListener('scroll', () => {
  if (tiltEl) { clearTilt(tiltEl); tiltEl = null; }
  clearTimeout(galScrollSettle);
  galScrollSettle = setTimeout(() => { const k = nearestCenterIndex(); if (k >= 0) { galleryIndex = k; updateGalleryDots(); } }, 90);
});

function openGallery(i) {
  if (galleryBusy || galleryOpen) return;
  const C = ctx[i];
  const objs = letterContents[i] || [];
  if (!objs.length) return;
  // ホバー開封アニメーションの途中でクリックされた場合は、開封が完全に終わってから展開する。
  // （未完了のまま FLIP すると中身が最終位置に達しておらず動きが破綻するため）
  if (!C.isOpen()) {
    galleryBusy = true;                       // 待機中の二重起動を防止
    C.holdOpenThen(() => { galleryBusy = false; openGallery(i); });
    return;
  }
  galleryBusy = true; galleryOpen = true; galleryLetter = i;
  gyroBase = null; // 開いた時点の端末姿勢を傾きの基準に取り直す
  gallery.classList.add('animating'); // FLIP中はスクロールスナップを切る
  C.cardEl.classList.add('gallery-dim'); // 上昇に同期してカードのグローをフェードアウト
  C.holdOpen(); // 展開中は封筒を開いたまま保持（ホバーが外れても閉じない）

  const envRect = C.envelopeEl.getBoundingClientRect();
  const L = galleryLift = Math.max(150, envRect.height * 0.42);
  const ordered = galSorted(objs);

  // ギャラリー枠を構築（img はまだ入れない＝受け渡し時に“本物のimg”そのものを移動してくる）
  galleryTrack.innerHTML = '';
  ordered.forEach(({ o }) => {
    const it = document.createElement('div'); it.className = 'gallery-item';
    it.dataset.galScale = galScale(o); // 傾きboostの基準（1が基準、小さいほど強める）
    const tilt = document.createElement('div'); tilt.className = 'gi-tilt';
    if (o.sticker) { // 反射はステッカーONのみ。imgは後で gi-tilt の先頭に入れるので glare が上に乗る
      const glare = document.createElement('div'); glare.className = 'g-glare';
      glare.style.webkitMaskImage = `url("${o.src}")`;
      glare.style.maskImage = `url("${o.src}")`;
      tilt.appendChild(glare);
    }
    it.appendChild(tilt);
    galleryTrack.appendChild(it);
  });
  galleryTrack.style.visibility = 'hidden';
  buildGalleryDots(ordered.length);

  // ── フェーズ1: 本物の中身を「封筒のレイヤー中間」のままグループ上昇 ──
  const riseAnim = C.contentsEl.animate(
    [{ transform: 'translateY(0px)' }, { transform: `translateY(-${L}px)` }],
    { duration: RISE_MS, easing: 'cubic-bezier(.34,0,.5,1)', fill: 'forwards' });

  // ── フェーズ2: 上昇の実際の終了で、本物のimgを“そのまま”ギャラリーへ移動して中央へ ──
  const toCenter = once(() => {
    gallery.classList.add('active');
    const srcEls = Array.from(C.contentsEl.children);
    // 1. 移動前に各imgの今の見た目（中心・回転・実寸幅）を記録（content-obj基準＝回転を正しく扱う）
    const recs = ordered.map(({ idx }, k) => {
      const galItem = galleryTrack.children[k];
      const cObj = srcEls[idx];
      const img = cObj && cObj.querySelector('img');
      if (!galItem || !cObj || !img) return null;
      const r = cObj.getBoundingClientRect();
      const m = new DOMMatrix(getComputedStyle(cObj).transform);
      const s = Math.hypot(m.a, m.b) || 1;
      return { galItem, cObj, img,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        cw: cObj.offsetWidth * s,                 // 回転前の実描画幅
        rot: Math.atan2(m.b, m.a) * 180 / Math.PI };
    });
    // 2. 同じimg要素をギャラリーへ移動（複製しない・gi-tiltの先頭へ＝glareが上）
    recs.forEach((r) => { if (r) { const t = r.galItem.querySelector('.gi-tilt'); t.insertBefore(r.img, t.firstChild); } });
    // 3. ギャラリーサイズ確定 → 先頭(並び順0)を中央へ
    sizeGalleryItems(ordered);
    galleryIndex = 0;
    galleryCenterIndex(0, false);
    updateGalleryDots();
    // 4. 封筒側を後始末（imgは抜けた）
    C.contentsEl.style.visibility = 'hidden';
    riseAnim.cancel(); C.contentsEl.style.transform = '';
    // 5. FLIP: 各itemを記録した上昇位置へ inline で確定 → 表示 → 中央へ
    recs.forEach((r) => {
      if (!r) return;
      const t = r.galItem.getBoundingClientRect();
      const dx = r.cx - (t.left + t.width / 2);
      const dy = r.cy - (t.top + t.height / 2);
      const scale = t.width ? r.cw / t.width : 1;
      r.start = `translate(${dx}px, ${dy}px) rotate(${r.rot}deg) scale(${scale})`;
      r.galItem.style.transform = r.start;
    });
    galleryTrack.style.visibility = '';
    gallery.classList.add('show-bg');
    recs.forEach((r) => {
      if (!r) return;
      const a = r.galItem.animate(
        [{ transform: r.start }, { transform: 'translate(0px,0px) rotate(0deg) scale(1)' }],
        { duration: CENTER_MS, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'both' });
      a.onfinish = () => { r.galItem.style.transform = ''; a.cancel(); };
    });
    setTimeout(() => { galleryBusy = false; gallery.classList.remove('animating'); }, CENTER_MS + 30);
  });
  riseAnim.onfinish = toCenter;
  setTimeout(toCenter, RISE_MS + 150);
}

function closeGallery() {
  if (!galleryOpen || galleryBusy) return;
  galleryBusy = true;
  gallery.classList.add('animating'); // FLIP中はスクロールスナップを切る
  clearTilt(tiltEl); tiltEl = null; tiltMouse = null;
  const C = ctx[galleryLetter];
  const objs = letterContents[galleryLetter] || [];
  const ordered = galSorted(objs);
  const L = galleryLift;

  gallery.classList.remove('show-bg');
  // ── フェーズ1: 各item（本物のimg）を中央 → 封筒内の最終位置-L（上昇位置）へ FLIP上昇 ──
  const recs = ordered.map(({ idx }, k) => {
    const galItem = galleryTrack.children[k];
    const cObj = C ? C.contentsEl.children[idx] : null;
    const img = galItem && galItem.querySelector('img');
    if (!galItem || !cObj || !img) return null;
    const fr = contentFinalRect(C, objs[idx]);          // 封筒内・最終位置
    const t = galItem.getBoundingClientRect();          // 今のスロット（中央・identity）
    const dx = fr.cx - (t.left + t.width / 2);
    const dy = (fr.cy - L) - (t.top + t.height / 2);    // 最終位置 - L = 上昇位置
    const scale = t.width ? fr.w / t.width : 1;
    const lifted = `translate(${dx}px, ${dy}px) rotate(${fr.rot}deg) scale(${scale})`;
    const a = galItem.animate(
      [{ transform: 'translate(0px,0px) rotate(0deg) scale(1)' }, { transform: lifted }],
      { duration: UP_MS, easing: 'cubic-bezier(.4,0,.4,1)', fill: 'forwards' });
    return { galItem, cObj, img, a };
  });
  const anims = recs.filter(Boolean).map((r) => r.a);

  // ── 上昇の実際の終了で受け渡し: imgを封筒へ戻し、本物を上昇位置で出して収納 ──
  const toStow = once(() => {
    if (!C) {
      gallery.classList.remove('active', 'animating'); galleryTrack.innerHTML = ''; galleryDots.innerHTML = '';
      galleryOpen = false; galleryBusy = false; galleryLetter = -1; return;
    }
    // 本物のimgを content-obj へ戻す（同じ要素・ギャラリー用inlineサイズは解除・shineより前へ）
    recs.forEach((r) => {
      if (!r) return;
      r.img.style.width = ''; r.img.style.height = '';
      r.cObj.insertBefore(r.img, r.cObj.firstChild);
    });
    gallery.classList.remove('active');
    galleryTrack.innerHTML = ''; galleryDots.innerHTML = '';
    // 本物を上昇位置で表示（複製の終端と一致）→ 0 へ下降
    C.contentsEl.style.transform = `translateY(-${L}px)`;
    C.contentsEl.style.visibility = '';
    C.cardEl.classList.remove('gallery-dim'); // 収納の下降に同期してグローをフェードイン
    const drop = C.contentsEl.animate(
      [{ transform: `translateY(-${L}px)` }, { transform: 'translateY(0px)' }],
      { duration: DOWN_MS, easing: 'cubic-bezier(.4,0,.3,1)', fill: 'forwards' });
    const finishStow = once(() => {
      drop.cancel(); C.contentsEl.style.transform = '';
      C.releaseClose();
      gallery.classList.remove('animating');
      galleryOpen = false; galleryBusy = false; galleryLetter = -1;
    });
    drop.onfinish = finishStow;
    setTimeout(finishStow, DOWN_MS + 150);
  });
  if (anims.length) anims[anims.length - 1].onfinish = toStow;
  setTimeout(toStow, UP_MS + 150);
}

// 閉じる: 背景クリック / ×ボタン / Esc（封筒側はトグル）
galleryBackdrop.addEventListener('click', closeGallery);
galleryCloseBtn.addEventListener('click', closeGallery);
// ホイール（縦/横どちらでも）＝1ジェスチャで1つ移動（縦デッキと同じ仕組み）
let galleryWheelLock = false;
galleryScroll.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (galleryBusy || galleryWheelLock) return;
  const d = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (Math.abs(d) < 8) return;
  galleryWheelLock = true;
  galleryGoTo(galleryIndex + (d > 0 ? 1 : -1));
  setTimeout(() => { galleryWheelLock = false; }, 500);
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (!galleryOpen) return;
  if (e.key === 'Escape')     { e.preventDefault(); closeGallery(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); galleryGoTo(galleryIndex + 1); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); galleryGoTo(galleryIndex - 1); }
});
