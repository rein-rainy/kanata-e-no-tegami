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
   ・IndexedDB を優先。無ければ BAKED_CONTENTS を使用。
   ・確定したらエディタの「📦 画像をファイル化して焼き込み用JSON…」ボタンで
     画像を assets/contents に書き出し、出力された軽量JSONを BAKED_CONTENTS に貼り付け。
     （src がパス参照になるので JSON は数KB で済む＝base64埋め込みの肥大化を回避）
============================================================ */

const BAKED_CONTENTS =
{
  "0": [
    {
      "src": "assets/contents/embed01.webp",
      "init": {
        "x": 53.1369346178266,
        "y": 90.18211725813754,
        "rot": 4.019402859697041,
        "scale": 1.5714309679756318
      },
      "final": {
        "x": 53.795586350490844,
        "y": 43.803113598433285,
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
        "x": 41.68955724240666,
        "y": 74.89688593816271,
        "rot": 0.4572213227131394,
        "scale": 1.3915609234028414
      },
      "final": {
        "x": 37.06615052166506,
        "y": 35.185778710018965,
        "rot": -6.657516164104653,
        "scale": 1.3915609234028414
      },
      "ctrl": {
        "x": 39.90481708326436,
        "y": 40.412225522744485
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
        "x": 57.98428340798707,
        "y": 82.57805063569862,
        "rot": 3.4899943371104647,
        "scale": 1.4106076244580672
      },
      "final": {
        "x": 63.54545216137945,
        "y": 48.465004697773146,
        "rot": 3.4899943371104647,
        "scale": 1.4106076244580672
      },
      "ctrl": {
        "x": 59.926336699221984,
        "y": 57.19610926670161
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
      "src": "assets/contents/embed06.webp",
      "init": {
        "x": 49.713159778279,
        "y": 85.68035682879432,
        "rot": -0.5361309672381962,
        "scale": 1.4778218127034104
      },
      "final": {
        "x": 49.32828972365229,
        "y": 38.11934570409283,
        "rot": 4.849257758355359,
        "scale": 1.4778218127034104
      },
      "ctrl": {
        "x": 46.95662969707002,
        "y": 55.07892131166637
      },
      "sticker": false,
      "gallery": {
        "order": 0,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed04.webp",
      "init": {
        "x": 78.85583797136155,
        "y": 55.94612557931224,
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
        "x": 31.751100500645403,
        "y": 73.59694598771728,
        "rot": -0.08313750195654546,
        "scale": 0.8477848060055927
      },
      "final": {
        "x": 17.459592472173295,
        "y": 26.574696584723508,
        "rot": -5.703695393336213,
        "scale": 0.8477848060055927
      },
      "ctrl": {
        "x": 31.402913424929647,
        "y": 44.63349641796261
      },
      "gallery": {
        "order": 1,
        "scale": 0.5
      },
      "sticker": true
    }
  ],
  "2": [
    {
      "src": "assets/contents/embed17.webp",
      "init": {
        "x": 52.42592286045357,
        "y": 87.53113169083815,
        "rot": -0.42530049412223736,
        "scale": 1.5026183985058323
      },
      "final": {
        "x": 55.263201456712466,
        "y": 40.34361348942863,
        "rot": 4.280716447251592,
        "scale": 1.5026183985058323
      },
      "ctrl": {
        "x": 50.67704022512829,
        "y": 49.459054109150216
      },
      "gallery": {
        "order": 0,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed18.svg",
      "init": {
        "x": 59.93213044197981,
        "y": 76.18364494146428,
        "rot": -0.27944836013308816,
        "scale": 1.3831119406738994
      },
      "final": {
        "x": 63.35043866909452,
        "y": 36.31163725318889,
        "rot": 9.08030520140003,
        "scale": 1.3831119406738994
      },
      "ctrl": {
        "x": 58.08475417977156,
        "y": 48.43613489428621
      },
      "gallery": {
        "order": 3,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed19.webp",
      "init": {
        "x": 25.376593279258405,
        "y": 75.72205719610928,
        "rot": -0.7619687777297761,
        "scale": 0.7048990175876083
      },
      "final": {
        "x": 19.914749213706344,
        "y": 30.885433047935233,
        "rot": -7.289451931771339,
        "scale": 0.7048990175876083
      },
      "ctrl": {
        "x": 26.195166363184903,
        "y": 45.05722523152193
      },
      "gallery": {
        "order": 1,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed20.webp",
      "init": {
        "x": 46.95662969707002,
        "y": 72.5571961092667,
        "rot": 0,
        "scale": 0.8548130214338889
      },
      "final": {
        "x": 44.85929481873862,
        "y": 49.1101403692702,
        "rot": 0,
        "scale": 0.8548130214338889
      },
      "ctrl": {
        "x": 47.43337195828505,
        "y": 58.29693051429903
      },
      "gallery": {
        "order": 3,
        "scale": 1
      }
    }
  ],
  "3": [
    {
      "src": "assets/contents/embed21.webp",
      "init": {
        "x": 43.41665287204105,
        "y": 85.58681344283302,
        "rot": -0.5132929161907547,
        "scale": 1.4763212298706458
      },
      "final": {
        "x": 39.867571594106934,
        "y": 38.43351389131574,
        "rot": -4.342335414064703,
        "scale": 1.4763212298706458
      },
      "ctrl": {
        "x": 42.99619268333058,
        "y": 49.713873842390356
      },
      "gallery": {
        "order": 1,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed11.webp",
      "init": {
        "x": 58.70175099707413,
        "y": 87.51418316661207,
        "rot": 0.2787098717332004,
        "scale": 1.472301460448415
      },
      "final": {
        "x": 61.08153879583878,
        "y": 48.085137136007894,
        "rot": 4.255362203987504,
        "scale": 1.472301460448415
      },
      "ctrl": {
        "x": 58.36305706957358,
        "y": 65.60935627159276
      },
      "gallery": {
        "order": 1,
        "scale": 1
      }
    }
  ],
  "4": [],
  "5": [
    {
      "src": "assets/contents/embed22.webp",
      "init": {
        "x": 43.458036748882634,
        "y": 83.32255809889918,
        "rot": 0,
        "scale": 1.4334100527715397
      },
      "final": {
        "x": 41.26965734149975,
        "y": 44.82948919564331,
        "rot": -4.163077270220371,
        "scale": 1.4334100527715397
      },
      "ctrl": {
        "x": 44.53070683661645,
        "y": 63.258634748674936
      },
      "gallery": {
        "order": 0,
        "scale": 1
      }
    }
  ],
  "6": [],
  "7": [
    {
      "src": "assets/contents/embed23.webp",
      "init": {
        "x": 50.40059592782651,
        "y": 94.77019628400022,
        "rot": -0.449364652896481,
        "scale": 1.7013504308236158
      },
      "final": {
        "x": 46.873034265850016,
        "y": 43.07964936804706,
        "rot": -4.1044099660815165,
        "scale": 1.7013504308236158
      },
      "ctrl": {
        "x": 50,
        "y": 49
      },
      "gallery": {
        "order": 3,
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
        "x": 48.74780943423954,
        "y": 73.64564115887173,
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
      "src": "assets/contents/embed24.webp",
      "init": {
        "x": 41.45091872206588,
        "y": 80.99423379346496,
        "rot": 0.36959993312316275,
        "scale": 1.3356138417735717
      },
      "final": {
        "x": 36.68349610991557,
        "y": 39.5794746345157,
        "rot": -4.134976252252849,
        "scale": 1.3356138417735717
      },
      "ctrl": {
        "x": 39.70038073166694,
        "y": 49.18384879725085
      },
      "gallery": {
        "order": 1,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed15.webp",
      "init": {
        "x": 57.97750711239086,
        "y": 72.94007734400006,
        "rot": -0.21526219974479233,
        "scale": 1.3613839816335427
      },
      "final": {
        "x": 67.92274186080901,
        "y": 29.15266712068159,
        "rot": 6.274003027438181,
        "scale": 1.3613839816335427
      },
      "ctrl": {
        "x": 58.21221652044364,
        "y": 42.59566660842216
      },
      "sticker": true,
      "gallery": {
        "order": 1,
        "scale": 0.8
      }
    }
  ]
}

const BAKED_STORY =
[
  {
    "type": "heading",
    "text": "ポートフォリオを「手紙」にする"
  },
  {
    "type": "text",
    "text": "きっかけは、前期の課題『彼方への手紙』でした。手紙をデジタルに変換してQRコードにし、遠くの誰かへ届ける、という案を考えたのが始まりです。物としての手紙をできるだけ小さくして、中身だけをデジタルにのせて飛ばす。この「物を最小にして、中身をデジタルで飛ばす」という発想が面白かったので、ポートフォリオそのものをこの形にしてみようと思いました。そこでこのサイトは、制作物を一覧で並べるのではなく、一通ずつの手紙として綴じています。作品を「見せる」のではなく「渡す」。受け取った人が封を開けて中を覗く、という体験そのものをサイトの構造にしました。"
  },
  {
    "type": "heading",
    "text": "手紙そのものを立体で作る"
  },
  {
    "type": "text",
    "text": "手紙は、平面の画像ではなく3つのレイヤーに分けてBlenderで3Dとして制作しました。立体感を追求するためで、封筒や中身が本当に厚みを持った物として存在しているように見せることを狙っています。この立体的な素材が、あとの開封の動きや傾きの表現の土台になっています。"
  },
  {
    "type": "image",
    "src": "assets/contents/story01.webp",
    "caption": ""
  },
  {
    "type": "heading",
    "text": "封を開ける、という体験"
  },
  {
    "type": "text",
    "text": "このサイトの中心は、封筒が開いて中身が飛び出る瞬間です。封筒がまず開き、中の写真やステッカーが動き出し、閉じるときは中身が収まってから封筒が閉じる。ただ画面が切り替わるのではなく、実際に一通を開封しているような手ざわりが出るよう作り込みました。中身は直線ではなく弧を描いて浮かび上がり、紙が封筒から滑り出て空気に乗るような動きを目指しました。"
  },
  {
    "type": "image",
    "src": "assets/contents/story02.webp",
    "caption": ""
  },
  {
    "type": "text",
    "text": "一枚一枚の配置を自分の手で詰めていくために、専用の編集画面も作りました。封筒の中身を画面上で自由に置き、回してサイズを変え、飛び出すときの軌道のカーブまで調整できます。この細部を手作業で納得いくまで詰められる仕組みそのものを用意したことが、裏側でいちばんこだわった点かもしれません。"
  },
  {
    "type": "heading",
    "text": "本物に近づけるための仕掛け"
  },
  {
    "type": "text",
    "text": "手紙らしさを出すために、細かい工夫を重ねています。ステッカーの表面には、シールらしく斜めの光がすっと横切ります。展開したギャラリーでは、中央の一枚がカーソルの位置に合わせて立体的に傾き、光の反射もその方向へ動く。スマホでは端末を傾けると同じように反応するので、手に取って光にかざしている感覚になります。細部の見せ方にもこだわっていて、CDは、クリックすると回転しながらラジオが再生されます。"
  },
  {
    "type": "heading",
    "text": "背景 ─ 空とアスキーアート"
  },
  {
    "type": "text",
    "text": "背景は、After Effectsで空の映像にアスキーアートを重ねて制作しました。手紙というアナログな媒体をデジタルに置き換えた、というこのサイトのコンセプトを、背景そのもので表現するためです。アスキーアートはそのまま使うと平坦な見た目になってしまうので、2種類のノイズを加えることで、単調にならない複雑な質感を持たせています。"
  },
  {
    "type": "image",
    "src": "assets/contents/story03.webp",
    "caption": "ノイズ適用前のアスキーアート"
  },
  {
    "type": "image",
    "src": "assets/contents/story04.webp",
    "caption": "ノイズ適用後のアスキーアート"
  }
]

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
