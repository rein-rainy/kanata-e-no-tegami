/* ============================================================
   設定
============================================================ */
const TOTAL_FRAMES = 30;
const DURATION = 500;     // 封筒は0.5秒で 1→30
const BACK_FRAME = 15;    // このフレーム以降 envelope01 を最背面へ
const DEBUG = new URLSearchParams(location.search).has('debug'); // ?debug でエディタ起動

// 中身: envelope が CONTENT_START_FRAME に達してから 1秒・イーズインアウトで再生
const CONTENT_START_FRAME = 5;
const CONTENT_DURATION = 450;  // ホバーで中身が出る/戻る速さ（短いほど速い）
const SHINE_DURATION = 450; // ステッカーのハイライトが横切る時間（長いほど遅い）
const easeInOut = (p) => (p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3) / 2); // cubic ease-in-out
// 2次ベジエ（位置パスの曲線用）: a=始点, c=制御点, b=終点
const qbez = (a, c, b, t) => {
  const u = 1 - t;
  return u*u*a + 2*u*t*c + t*t*b;
};
const contentDelay = (CONTENT_START_FRAME - 1) / (TOTAL_FRAMES - 1) * DURATION;
const CONTENT_TOTAL = contentDelay + CONTENT_DURATION;
const SEQ_DELAY = 300; // 封筒と中身を順番に動かす遅延（開く=中身の遅れ / 閉じる=封筒の遅れ）

// info: ラベル画像（assets/Info）。日付・タイトルが画像に焼き込み済みのため、
// 連番 (i+1) ではなく各手紙に固定で持たせる（手紙を削除しても他のラベルがずれない）。
const WORKSHOPS = [
  { date: '4/20', title: '状態気象観測', info: 'assets/Info/Info-1.png' },
  { date: '4/27', title: 'Freaks', info: 'assets/Info/Info-2.png' },
  { date: '5/11', title: 'REMIX / SAMPLING', info: 'assets/Info/Info-3.png' },
  { date: '5/18', title: '彼方への手紙', info: 'assets/Info/Info-4.png' },
  { date: '6/1',  title: 'ペーパー仮装大賞 本番', info: 'assets/Info/Info-5.png' },
  { date: '6/15', title: 'ラジオ制作', info: 'assets/Info/Info-6.png' },
  { date: '6/22', title: 'ラジオ 放送日', info: 'assets/Info/Info-7.png' },
];

// envelope01 / envelope02 はどちらも30フレームのアニメーション
// 影はあらかじめ envelope01 の素材に焼き込み済みのため、実行時の影合成は不要。
const framePath  = (n) => `assets/envelope01/${String(n).padStart(4, '0')}.webp`;
const framePath2 = (n) => `assets/envelope02/${String(n).padStart(4, '0')}.webp`;
// 特別な手紙（このサイトについて）用: envelope01〜03を統合した30フレームの回転アニメ。
const rotatePath = (n) => `assets/envelope_rotate/${String(n).padStart(4, '0')}.webp`;

// フレームを「一度だけデコードして保持」し、全封筒で共有する。
// 旧方式（毎フレーム img.src を差し替え）は WebP の再デコードがメインスレッドで
// 走って重かったため、事前デコード済み素材を canvas に drawImage する（deck.js）。
// 原寸(950x1080)を多数RGBA保持すると重いので、表示サイズ×DPRに縮小して保持。
const FRAME_BITMAPS = { e1: [], e2: [] }; // 封筒レイヤー。index 1..TOTAL_FRAMES
let framesReady = null; // deck.js が表示実寸を測ってから loadFrames() を一度だけ呼ぶ

// maxW: デコード先の最大幅(px)。onFirst: 先頭フレームが描ける状態になった時に1度呼ぶ。
function loadFrames(maxW, onFirst) {
  if (framesReady) return framesReady;
  const w = Math.min(950, Math.max(1, Math.round(maxW || 950)));
  const h = Math.round(w * 1080 / 950);
  const canBitmap = (typeof createImageBitmap === 'function');
  const opt = canBitmap ? { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' } : null;
  // 1枚デコードして ImageBitmap（不可なら <img>）を返す。失敗時は null。
  const decode = (path) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (opt) createImageBitmap(img, opt).then(resolve, () => resolve(img));
      else resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = path;
  });
  const loadFrame = async (i) => {
    const [e1, e2] = await Promise.all([
      decode(framePath(i)), decode(framePath2(i)),
    ]);
    FRAME_BITMAPS.e1[i] = e1;
    FRAME_BITMAPS.e2[i] = e2;
  };
  framesReady = (async () => {
    await loadFrame(1); // 先頭フレームを最優先 → 初期表示(閉じた状態)を即描画
    if (typeof onFirst === 'function') onFirst();
    const tasks = [];
    for (let i = 2; i <= TOTAL_FRAMES; i++) tasks.push(loadFrame(i));
    await Promise.all(tasks);
  })();
  return framesReady;
}

// 特別な手紙用の回転フレーム（統合済み1レイヤー）を事前デコードして保持。
const ROTATE_BITMAPS = []; // index 1..TOTAL_FRAMES
let rotateReady = null;
function loadRotateFrames(maxW, onFirst) {
  if (rotateReady) return rotateReady;
  const w = Math.min(950, Math.max(1, Math.round(maxW || 950)));
  const h = Math.round(w * 1080 / 950);
  const canBitmap = (typeof createImageBitmap === 'function');
  const opt = canBitmap ? { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' } : null;
  const decode = (path) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (opt) createImageBitmap(img, opt).then(resolve, () => resolve(img));
      else resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = path;
  });
  rotateReady = (async () => {
    ROTATE_BITMAPS[1] = await decode(rotatePath(1)); // 先頭を最優先（初期表示）
    if (typeof onFirst === 'function') onFirst();
    const tasks = [];
    for (let i = 2; i <= TOTAL_FRAMES; i++) {
      tasks.push(decode(rotatePath(i)).then((bm) => { ROTATE_BITMAPS[i] = bm; }));
    }
    await Promise.all(tasks);
  })();
  return rotateReady;
}

/* ============================================================
   手紙の中身データ（手紙ごと・envelope02と03の間に配置）
   letterContents[letterIndex] = [ { src, w, init, final }, ... ]
   state = { x, y (各 %, 中心位置), rot(deg), scale, op(0-1) }
   ・IndexedDB を優先。無ければ BAKED_CONTENTS（js/baked.js）を使用。
   ・確定したら dev_server.py で起動し、エディタの「焼き込み書き出し（自動保存）」
     ボタンで画像を assets/contents へ、データを js/baked.js へ自動書き込み。
     （src がパス参照になるので baked.js は数KBで済む）
============================================================ */

// BAKED_CONTENTS / BAKED_STORY は js/baked.js に分離（index.html で config.js より前に読み込む）

/* 保存は IndexedDB を使用（画像をbase64で埋め込むため localStorage の容量制限を超える）。 */
const DB_NAME = 'choki', DB_STORE = 'kv', DB_KEY = 'letterContents';
const STORY_DB_KEY = 'storyContent'; // 特別な手紙（ブログ本文）の保存キー
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key = DB_KEY) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const rq = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbSet(val, key = DB_KEY) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(JSON.parse(JSON.stringify(val)), key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// 初期はBAKEDで開始し、起動後にIndexedDBから非同期で読み込む
let letterContents = JSON.parse(JSON.stringify(BAKED_CONTENTS));
let storyContent = JSON.parse(JSON.stringify(BAKED_STORY));
let editorRefresh = null; // エディタ再描画フック（DEBUG時のみ設定）
let storyRefresh = null;  // 特別な手紙のエディタ再描画フック（DEBUG時のみ設定）
function saveContents() { return idbSet(letterContents); } // Promiseを返す
function saveStory() { return idbSet(storyContent, STORY_DB_KEY); }

const defaultState = (over = {}) => Object.assign({ x: 50, y: 50, rot: 0, scale: 1 }, over);
const lerp = (a, b, p) => a + (b - a) * p;
// 位置は left/top(%) ではなく transform のみで適用する（CSS側で left:0; top:0 固定）。
// left/top の毎フレーム更新はレイアウト(reflow)を毎回走らせ、スマホの開封/収納が
// カクつく原因になるため、コンポジタだけで完結する translate(px) に一本化。
// 親(.contents=封筒と同サイズ)の実寸を参照するので、必ず appendChild 後に呼ぶこと。
function applyState(el, st) {
  const box = el.parentElement;
  if (!box) return;
  const x = st.x * box.clientWidth / 100;
  const y = st.y * box.clientHeight / 100;
  el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${st.rot}deg) scale(${st.scale})`;
}
