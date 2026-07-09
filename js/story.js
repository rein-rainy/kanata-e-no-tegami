/* ============================================================
   特別な手紙（このサイトについて）の展開
   封筒クリック → 封筒が画面上部へアイコン化して移動（FLIP）し、
   ギャラリーと同じ背景ぼかし＋暗転の上に、ブログ形式の本文
   （storyContent: 見出し/本文/画像ブロック）を表示する。
   閉じる: アイコン / × / 背景 / 余白クリック / Esc → 封筒位置へ戻る。
============================================================ */
const story = document.createElement('div');
story.className = 'story';
story.innerHTML = `
  <div class="story-backdrop"></div>
  <div class="story-scroll">
    <header class="story-head">
      <div class="story-icon" title="閉じる">
        <canvas class="story-icon-canvas" width="950" height="1080"></canvas>
      </div>
    </header>
    <article class="story-body"></article>
  </div>
  <button class="story-close" aria-label="閉じる">×</button>`;
document.body.appendChild(story);
const storyScroll   = story.querySelector('.story-scroll');
const storyIcon     = story.querySelector('.story-icon');
const storyIconCv   = story.querySelector('.story-icon-canvas');
const storyIconCtx  = storyIconCv.getContext('2d');
const storyBody     = story.querySelector('.story-body');

window.storyOpen = false; // deck.js のキー操作ガードからも参照
let storyBusy = false;
const STORY_FLIP_MS = 640;
// アイコンの静止表示は最終フレーム（回転しきった状態）。開くと 1→30 で回転する。
const drawIcon = (frame) => window.drawRotate(storyIconCv, storyIconCtx, frame);
drawIcon(TOTAL_FRAMES);

// storyContent のブロック配列から本文DOMを生成（エディタからも呼ばれる）
function renderStory() {
  storyBody.innerHTML = '';
  (storyContent || []).forEach((b) => {
    if (b.type === 'heading') {
      const h = document.createElement('h2');
      h.textContent = b.text || '';
      storyBody.appendChild(h);
    } else if (b.type === 'text') {
      const p = document.createElement('p');
      p.textContent = b.text || '';
      storyBody.appendChild(p);
    } else if (b.type === 'image' && b.src) {
      const f = document.createElement('figure');
      const im = document.createElement('img');
      im.src = b.src; im.alt = b.caption || '';
      f.appendChild(im);
      if (b.caption) {
        const c = document.createElement('figcaption');
        c.textContent = b.caption;
        f.appendChild(c);
      }
      storyBody.appendChild(f);
    }
  });
}

// デッキ上の封筒とヘッダーのアイコン間の FLIP 変換（中心合わせ＋スケール）
function storyFlip() {
  const s = specialEnvelope.getBoundingClientRect();
  const t = storyIcon.getBoundingClientRect();
  const dx = (s.left + s.width / 2) - (t.left + t.width / 2);
  const dy = (s.top + s.height / 2) - (t.top + t.height / 2);
  const scale = s.width / (t.width || 1);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

// アイコンcanvasのフレームを from→to へ ms かけて進める（回転アニメ）。
let rotRaf = null;
function playRotate(fromFrame, toFrame, ms) {
  if (rotRaf) cancelAnimationFrame(rotRaf);
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / ms);
    drawIcon(fromFrame + (toFrame - fromFrame) * p);
    rotRaf = p < 1 ? requestAnimationFrame(step) : null;
  };
  rotRaf = requestAnimationFrame(step);
}

function openStory() {
  if (window.storyOpen || storyBusy) return;
  storyBusy = true; window.storyOpen = true;
  renderStory();
  story.classList.add('active');
  storyScroll.scrollTop = 0;
  // FLIP: 封筒の位置・大きさ（大）からヘッダーのアイコン（小）へ縮小。
  // 同時にアイコンcanvasを 1→30 で回転再生 ＝「回転しながら縮小」。
  const from = storyFlip();
  drawIcon(1);
  specialEnvelope.style.visibility = 'hidden'; // 本物は隠してアイコンが引き継ぐ
  const anim = storyIcon.animate(
    [{ transform: from }, { transform: 'translate(0px, 0px) scale(1)' }],
    { duration: STORY_FLIP_MS, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'both' });
  anim.onfinish = () => { anim.cancel(); };
  playRotate(1, TOTAL_FRAMES, STORY_FLIP_MS);
  requestAnimationFrame(() => story.classList.add('show-bg'));
  setTimeout(() => { storyBusy = false; }, STORY_FLIP_MS + 40);
}

function closeStory() {
  if (!window.storyOpen || storyBusy) return;
  storyBusy = true;
  story.classList.remove('show-bg');
  // FLIP: アイコン（小）から封筒の位置（大）へ拡大。回転は 30→1 で巻き戻す。
  const to = storyFlip();
  const anim = storyIcon.animate(
    [{ transform: 'translate(0px, 0px) scale(1)' }, { transform: to }],
    { duration: STORY_FLIP_MS, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'both' });
  playRotate(TOTAL_FRAMES, 1, STORY_FLIP_MS);
  const finish = () => {
    if (!storyBusy) return;
    anim.cancel();
    if (rotRaf) { cancelAnimationFrame(rotRaf); rotRaf = null; }
    drawIcon(TOTAL_FRAMES); // 次回開封に備えて静止表示は最終フレームへ戻す
    specialEnvelope.style.visibility = '';
    if (window.drawSpecial) window.drawSpecial(1); // カード側は閉じた状態(フレーム1)
    story.classList.remove('active');
    window.storyOpen = false; storyBusy = false;
  };
  anim.onfinish = finish;
  setTimeout(finish, STORY_FLIP_MS + 150); // 念のためのフォールバック
}

specialEnvelope.addEventListener('click', () => {
  if (window.storyOpen) closeStory(); else openStory();
});
storyIcon.addEventListener('click', closeStory);
story.querySelector('.story-close').addEventListener('click', closeStory);
story.querySelector('.story-backdrop').addEventListener('click', closeStory);
// 本文の外側（余白）クリックでも閉じる
storyScroll.addEventListener('click', (e) => { if (e.target === storyScroll) closeStory(); });
window.addEventListener('keydown', (e) => {
  if (window.storyOpen && e.key === 'Escape') { e.preventDefault(); closeStory(); }
});

// 保存済みの本文を IndexedDB から非同期で読み込み（letterContents と同じ方針）
idbGet(STORY_DB_KEY).then((data) => {
  if (!data) return;
  storyContent = data;
  renderStory();
  if (storyRefresh) storyRefresh(); // エディタの一覧も更新
}).catch(() => {});
