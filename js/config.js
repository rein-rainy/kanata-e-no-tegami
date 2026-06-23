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

const WORKSHOPS = [
  { date: '4/20', title: '状態気象観測' },
  { date: '4/27', title: 'Freaks' },
  { date: '5/11', title: 'REMIX / SAMPLING' },
  { date: '5/18', title: '彼方への手紙' },
  { date: '5/25', title: 'ペーパー仮装大賞 制作' },
  { date: '6/1',  title: 'ペーパー仮装大賞 本番' },
  { date: '6/8',  title: 'ラジオ 制作' },
  { date: '6/15', title: 'ねぶたテーマ発表・ラジオ 制作' },
  { date: '6/22', title: 'ラジオ 放送日' },
];

// envelope01 / envelope02 / envelope01_shadow はどれも30フレームのアニメーション
const framePath  = (n) => `assets/envelope01/${String(n).padStart(4, '0')}.webp`;
const framePath2 = (n) => `assets/envelope02/${String(n).padStart(4, '0')}.webp`;
const framePath3 = (n) => `assets/envelope01_shadow/${String(n).padStart(4, '0')}.webp`;

// フレーム事前読み込み
for (let i = 1; i <= TOTAL_FRAMES; i++) {
  const a = new Image(); a.src = framePath(i);
  const b = new Image(); b.src = framePath2(i);
  const c = new Image(); c.src = framePath3(i);
}

/* ============================================================
   手紙の中身データ（手紙ごと・envelope02と03の間に配置）
   letterContents[letterIndex] = [ { src, w, init, final }, ... ]
   state = { x, y (各 %, 中心位置), rot(deg), scale, op(0-1) }
   ・IndexedDB を優先。無ければ BAKED_CONTENTS を使用。
   ・確定したらエディタの「📦 画像をファイル化して焼き込み用JSON…」ボタンで
     画像を assets/contents に書き出し、出力された軽量JSONを BAKED_CONTENTS に貼り付け。
     （src がパス参照になるので JSON は数KB で済む＝base64埋め込みの肥大化を回避）
============================================================ */
const BAKED_CONTENTS = {
  // 例:
  // 0: [ { src:"assets/contents/letter1.png", w:60,
  //        init:  {x:50, y:60, rot:-4, scale:0.9, op:0},
  //        final: {x:50, y:38, rot:0,  scale:1,   op:1} } ]
};
/* 保存は IndexedDB を使用（画像をbase64で埋め込むため localStorage の容量制限を超える）。 */
const DB_NAME = 'choki', DB_STORE = 'kv', DB_KEY = 'letterContents';
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const rq = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbSet(val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(JSON.parse(JSON.stringify(val)), DB_KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// 初期はBAKEDで開始し、起動後にIndexedDBから非同期で読み込む
let letterContents = JSON.parse(JSON.stringify(BAKED_CONTENTS));
let editorRefresh = null; // エディタ再描画フック（DEBUG時のみ設定）
function saveContents() { return idbSet(letterContents); } // Promiseを返す

const defaultState = (over = {}) => Object.assign({ x: 50, y: 50, rot: 0, scale: 1 }, over);
const lerp = (a, b, p) => a + (b - a) * p;
function applyState(el, st) {
  el.style.left = st.x + '%';
  el.style.top  = st.y + '%';
  el.style.transform = `translate(-50%, -50%) rotate(${st.rot}deg) scale(${st.scale})`;
}
