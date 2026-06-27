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

// envelope01 / envelope02 はどちらも30フレームのアニメーション
// 影はあらかじめ envelope01 の素材に焼き込み済みのため、実行時の影合成は不要。
const framePath  = (n) => `assets/envelope01/${String(n).padStart(4, '0')}.webp`;
const framePath2 = (n) => `assets/envelope02/${String(n).padStart(4, '0')}.webp`;

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
  "0": [
    {
      "src": "assets/contents/embed01.webp",
      "init": {
        "x": 53.907502404616864,
        "y": 90.82644715504476,
        "rot": 4.019402859697041,
        "scale": 1.5714309679756318
      },
      "final": {
        "x": 56.97138505931389,
        "y": 38.99502926038215,
        "rot": 4.019402859697041,
        "scale": 1.5714309679756318
      },
      "ctrl": {
        "x": 53.11898845783906,
        "y": 59.85687090178382
      },
      "gallery": {
        "order": 0,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed02.webp",
      "init": {
        "x": 28.394517473549215,
        "y": 68.91641401678064,
        "rot": -3.653445852608618,
        "scale": 1
      },
      "final": {
        "x": 21.546369028534784,
        "y": 29.416659949462144,
        "rot": -17.63591209963155,
        "scale": 1
      },
      "ctrl": {
        "x": 26.937720423212568,
        "y": 41.021821899457095
      },
      "sticker": true,
      "gallery": {
        "order": 1,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed03.webp",
      "init": {
        "x": 59.67357326066047,
        "y": 75.73796093915252,
        "rot": 3.4899943371104647,
        "scale": 1.4106076244580672
      },
      "final": {
        "x": 57.73184514267393,
        "y": 50.32373263766481,
        "rot": 3.4899943371104647,
        "scale": 1.4106076244580672
      },
      "ctrl": {
        "x": 56.491463610131454,
        "y": 60.74790241838821
      },
      "sticker": true,
      "gallery": {
        "order": 2,
        "scale": 1
      }
    }
  ],
  "1": [
    {
      "src": "assets/contents/embed04.webp",
      "init": {
        "x": 78.8674254568772,
        "y": 56.03567651413663,
        "rot": 0.0015272507512236189,
        "scale": 0.7363856088015848
      },
      "final": {
        "x": 86.4369589612055,
        "y": 13.806423182683492,
        "rot": 9.818004893464293,
        "scale": 0.7363856088015848
      },
      "ctrl": {
        "x": 78.88345623597307,
        "y": 28.348198547556937
      },
      "sticker": true,
      "gallery": {
        "order": 2,
        "scale": 0.5
      }
    },
    {
      "src": "assets/contents/embed05.webp",
      "init": {
        "x": 51.83151651170248,
        "y": 90.151343157301,
        "rot": 2.611988003693872,
        "scale": 1.5426183231243655
      },
      "final": {
        "x": 52.178182109650535,
        "y": 58.1737996192625,
        "rot": 6.23592979829526,
        "scale": 1.5426183231243655
      },
      "ctrl": {
        "x": 52.80037672330875,
        "y": 71.26136924487062
      },
      "gallery": {
        "order": 0,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed06.webp",
      "init": {
        "x": 21.189684193651814,
        "y": 57.23605725163928,
        "rot": -3.035654232562684,
        "scale": 0.7908478220456371
      },
      "final": {
        "x": 16.169044565565887,
        "y": 28.940738912782912,
        "rot": -8.432143754213834,
        "scale": 0.7908478220456371
      },
      "ctrl": {
        "x": 22.072378967617826,
        "y": 41.86790523866601
      },
      "sticker": true,
      "gallery": {
        "order": 1,
        "scale": 0.5
      }
    }
  ],
  "2": [
    {
      "src": "assets/contents/embed07.webp",
      "init": {
        "x": 51.027559427976136,
        "y": 95.15465892839788,
        "rot": 0.8078376099976383,
        "scale": 1.6135798458063786
      },
      "final": {
        "x": 51.690500994412346,
        "y": 52.73209946822542,
        "rot": 5.326822220920632,
        "scale": 1.6135798458063786
      },
      "ctrl": {
        "x": 50.7150298323705,
        "y": 70.00194382350082
      },
      "gallery": {
        "order": 0,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed08.webp",
      "init": {
        "x": 26.825504969541516,
        "y": 67.96104491292392,
        "rot": 21.046845530842496,
        "scale": 0.7869351789269977
      },
      "final": {
        "x": 17.409426098108362,
        "y": 32.907635902136356,
        "rot": 6.384213536048042,
        "scale": 0.7869351789269977
      },
      "ctrl": {
        "x": 26.222346906059634,
        "y": 46.92677853768596
      },
      "sticker": true,
      "gallery": {
        "order": 1,
        "scale": 0.5
      }
    },
    {
      "src": "assets/contents/embed09.webp",
      "init": {
        "x": 66.63293523565245,
        "y": 57.72167383487273,
        "rot": 13.400936024038284,
        "scale": 0.4603633278122781
      },
      "final": {
        "x": 77.02388586085284,
        "y": 9.111541986885708,
        "rot": 13.400936024038284,
        "scale": 0.4603633278122781
      },
      "ctrl": {
        "x": 69.06059634498236,
        "y": 35.35835154762744
      },
      "sticker": true,
      "gallery": {
        "order": 2,
        "scale": 0.5
      }
    },
    {
      "src": "assets/contents/embed10.svg",
      "init": {
        "x": 62.92977945564769,
        "y": 64.74899147123041,
        "rot": 0.06433416219043764,
        "scale": 1
      },
      "final": {
        "x": 65.3414555947419,
        "y": 44.21783120637382,
        "rot": 9.911975403625217,
        "scale": 1
      },
      "ctrl": {
        "x": 61.39298129448767,
        "y": 53.79899819442018
      },
      "sticker": true,
      "gallery": {
        "order": 3,
        "scale": 1
      }
    }
  ],
  "3": [
    {
      "src": "assets/contents/embed11.webp",
      "init": {
        "x": 58.611534145559474,
        "y": 86.10248184446168,
        "rot": 0.2787098717332004,
        "scale": 1.472301460448415
      },
      "final": {
        "x": 60.29276210323822,
        "y": 48.085137136007894,
        "rot": 4.255362203987504,
        "scale": 1.472301460448415
      },
      "ctrl": {
        "x": 58.36305706957358,
        "y": 65.60935627159276
      },
      "gallery": {
        "order": 0,
        "scale": 1
      }
    }
  ],
  "4": [],
  "5": [],
  "6": [],
  "7": [
    {
      "src": "assets/contents/embed05.webp",
      "init": {
        "x": 48.9159185636422,
        "y": 89.6824724587789,
        "rot": -0.17963161041873832,
        "scale": 1.548467903533419
      },
      "final": {
        "x": 41.82229881372236,
        "y": 41.47775554416282,
        "rot": -3.6216555303834923,
        "scale": 1.548467903533419
      },
      "ctrl": {
        "x": 48.68247034305867,
        "y": 49.11161249383064
      },
      "gallery": {
        "order": 0,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed12.svg",
      "init": {
        "x": 67.1699663353639,
        "y": 59.16794754283296,
        "rot": -11.646732437038107,
        "scale": 0.876791956984154
      },
      "final": {
        "x": 73.60732606604681,
        "y": 15.012091941056195,
        "rot": 20.982604527021277,
        "scale": 0.8646699035577305
      },
      "ctrl": {
        "x": 67.01366623917923,
        "y": 30.08090671931185
      },
      "sticker": true,
      "gallery": {
        "order": 3,
        "scale": 0.7
      }
    },
    {
      "src": "assets/contents/embed13.webp",
      "init": {
        "x": 50.90473709522281,
        "y": 69.35884518939184,
        "rot": 1.900880473815949,
        "scale": 1.745809762515756
      },
      "final": {
        "x": 56.8731965373517,
        "y": 41.08644150550797,
        "rot": 9.234853666763344,
        "scale": 1.745809762515756
      },
      "ctrl": {
        "x": 49.79059794806028,
        "y": 45.67968694916449
      },
      "gallery": {
        "order": 1,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed14.svg",
      "init": {
        "x": 26.58504328310356,
        "y": 62.640485087781144,
        "rot": 0.33056542607996686,
        "scale": 0.92
      },
      "final": {
        "x": 17.7009858929144,
        "y": 25.33695268983995,
        "rot": -9.712990457532419,
        "scale": 1
      },
      "ctrl": {
        "x": 27.200224430907344,
        "y": 37.8190439258267
      },
      "sticker": true,
      "gallery": {
        "order": 2,
        "scale": 0.7
      }
    }
  ],
  "8": [
    {
      "src": "assets/contents/CD-03.png",
      "cdStack": true,
      "init": {
        "x": 58.72241689553935,
        "y": 70.1945767324327,
        "rot": -0.21526219974479233,
        "scale": 1.3613839816335427
      },
      "final": {
        "x": 63.378792183603245,
        "y": 29.395109895450066,
        "rot": 6.274003027438181,
        "scale": 1.3613839816335427
      },
      "ctrl": {
        "x": 57.6696025507466,
        "y": 44.1296530275051
      },
      "gallery": {
        "order": 0,
        "scale": 0.8
      }
    }
  ]
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
