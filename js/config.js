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
      "src": "assets/contents/embed01.webp",
      "init": {
        "x": 37.46730673729514,
        "y": 81.4169142058361,
        "rot": -0.020945083962683242,
        "scale": 1.3098999004628078
      },
      "final": {
        "x": 35.33355404734315,
        "y": 36.382258722115445,
        "rot": -7.695163319838552,
        "scale": 1.3579533286517707
      },
      "ctrl": {
        "x": 39.781493130276445,
        "y": 48.040072223192965
      },
      "gallery": {
        "order": 0,
        "scale": 1
      }
    },
    {
      "src": "assets/contents/embed11.webp",
      "init": {
        "x": 58.611534145559474,
        "y": 86.10248184446168,
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
      "src": "assets/contents/embed02.webp",
      "init": {
        "x": 44.25757324946201,
        "y": 92.07711573184227,
        "rot": -0.2591071726127119,
        "scale": 1.607627837880746
      },
      "final": {
        "x": 43.01109087899354,
        "y": 44.83717747102336,
        "rot": -4.971245129867577,
        "scale": 1.607627837880746
      },
      "ctrl": {
        "x": 44.932958119516634,
        "y": 62.882957656240904
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
      "src": "assets/contents/embed03.webp",
      "init": {
        "x": 43.101307730508196,
        "y": 85.1991671035005,
        "rot": -0.015240987201153189,
        "scale": 1.5708607402098853
      },
      "final": {
        "x": 43.0830988246979,
        "y": 40.579503756770926,
        "rot": -5.0318458962262245,
        "scale": 1.5708607402098853
      },
      "ctrl": {
        "x": 47.568283396788615,
        "y": 52.933339157784374
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
        "x": 49.08632954680368,
        "y": 72.27398293765907,
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
      "src": "assets/contents/embed04.webp",
      "init": {
        "x": 41.18523423274292,
        "y": 86.23009493855204,
        "rot": 0.5603339104474889,
        "scale": 1.4458830287879194
      },
      "final": {
        "x": 38.00529713623572,
        "y": 34.806744714310675,
        "rot": -5.186591270872425,
        "scale": 1.4458830287879194
      },
      "ctrl": {
        "x": 39.82949842741268,
        "y": 48.45360824742268
      },
      "gallery": {
        "order": 0,
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
