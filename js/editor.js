/* ============================================================
   デバッグエディタ（?debug でのみ起動）
============================================================ */
if (DEBUG) initEditor();

// 保存済みデータを IndexedDB から非同期で読み込み、全カードへ反映
idbGet().then((data) => {
  if (!data) return;
  letterContents = data;
  ctx.forEach((c) => c.reset());        // 各カードの中身を再生成
  if (editorRefresh) editorRefresh();   // エディタも再描画
}).catch(() => {});

function initEditor() {
  document.body.classList.add('debug');

  let letter = 0;        // 編集中の手紙 (0-8)
  let sel = -1;          // 選択中オブジェクト index
  let stateKey = 'init'; // 'init' | 'final'

  const panel = document.createElement('div');
  panel.id = 'editor';
  panel.innerHTML = `
    <div class="ed-head">
      <h2>手紙エディタ</h2>
      <span class="ed-badge"><i></i>DEBUG</span>
    </div>
    <div class="row">
      <label>編集する手紙</label>
      <select id="ed-letter"></select>
    </div>
    <div class="sec">
      <div class="sec-head">
        <label>オブジェクト</label>
        <button class="btn sm" id="ed-add">画像を追加</button>
        <input type="file" id="ed-file" accept="image/*" hidden>
      </div>
      <div class="objlist" id="ed-list"></div>
    </div>
    <div class="sec">
      <div class="sec-head">
        <label>ギャラリー展開 — 並び順・スケール</label>
        <button class="btn sm" id="ed-gallery">確認</button>
      </div>
      <div class="objlist" id="ed-glist"></div>
    </div>
    <div id="ed-controls" style="display:none">
      <div class="sec">
        <div class="state-tabs">
          <button class="btn on" id="ed-init">初期状態</button>
          <button class="btn" id="ed-final">最終状態</button>
        </div>
        <div class="row">
          <label>画像パス / src</label>
          <input type="text" id="ed-src">
        </div>
        <div class="toggle-row">
          <label>ステッカーエフェクト</label>
          <button class="btn sm" id="ed-sticker">OFF</button>
        </div>
        <div class="btnrow">
          <button class="btn" id="ed-copystate">反対へコピー</button>
          <button class="btn" id="ed-dup">複製</button>
          <button class="btn danger" id="ed-del">削除</button>
        </div>
        <button class="btn wide" id="ed-play">初期から再生</button>
        <p class="hint">封筒上で直接操作 — ドラッグ: 移動 / 四隅: 拡縮 / 上のノブ: 回転 / パス上の点: 曲がりの調整</p>
      </div>
    </div>
    <div class="sec">
      <button class="btn primary wide" id="ed-save">保存</button>
      <div class="btnrow">
        <button class="btn" id="ed-export">JSONコピー</button>
        <button class="btn danger" id="ed-clear">この手紙を空に</button>
      </div>
      <button class="btn wide" id="ed-bake">画像を焼き込んでJSON書き出し</button>
      <p class="hint">埋め込み画像を webp で assets/contents に保存し、軽量JSONを js/config.js の BAKED_CONTENTS へ貼り付けます。</p>
      <textarea id="ed-json" placeholder="書き出したJSONがここに表示されます" readonly></textarea>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = (id) => panel.querySelector(id);
  const selLetter = $('#ed-letter');
  WORKSHOPS.forEach((w, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = `${i + 1}. ${w.date}　${w.title}`;
    selLetter.appendChild(o);
  });

  const list  = () => letterContents[letter] || (letterContents[letter] = []);
  const curObj = () => list()[sel];
  const curState = () => (curObj() ? curObj()[stateKey] : null);

  function refreshList() {
    const wrap = $('#ed-list'); wrap.innerHTML = '';
    const arr = list();
    // 配列順=描画順（末尾が前面）。上に行くほど前面に見えるよう逆順で表示。
    for (let idx = arr.length - 1; idx >= 0; idx--) {
      const o = arr[idx];
      const it = document.createElement('div');
      it.className = 'objitem' + (idx === sel ? ' sel' : '');
      it.innerHTML =
        `<img src="${o.src}"><span>オブジェクト ${idx + 1}</span>` +
        `<button class="objmove" data-act="front" title="前面へ"${idx === arr.length - 1 ? ' disabled' : ''}>▲</button>` +
        `<button class="objmove" data-act="back" title="背面へ"${idx === 0 ? ' disabled' : ''}>▼</button>`;
      it.addEventListener('click', (e) => {
        if (e.target.classList.contains('objmove')) return; // ボタンは別処理
        sel = idx; refreshAll();
      });
      it.querySelector('[data-act=front]').addEventListener('click', () => moveObj(idx, +1));
      it.querySelector('[data-act=back]').addEventListener('click', () => moveObj(idx, -1));
      wrap.appendChild(it);
    }
  }
  // dir=+1: 前面へ（配列で後ろへ） / dir=-1: 背面へ（配列で前へ）
  function moveObj(idx, dir) {
    const arr = list();
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    sel = j;
    markDirty(); refreshAll();
  }
  function refreshControls() {
    const c = $('#ed-controls');
    if (!curObj()) { c.style.display = 'none'; return; }
    c.style.display = 'block';
    $('#ed-init').classList.toggle('on', stateKey === 'init');
    $('#ed-final').classList.toggle('on', stateKey === 'final');
    const o = curObj();
    $('#ed-src').value = o.src.startsWith('data:') ? '(data URL / 画像埋め込み)' : o.src;
    $('#ed-sticker').classList.toggle('on', !!o.sticker);
    $('#ed-sticker').textContent = o.sticker ? 'ON' : 'OFF';
  }
  // ── 横スクロール（ギャラリー）並び順＆スケール ──
  function ensureGal(o, idx) {
    if (!o.gallery) o.gallery = { order: idx, scale: 1 };
    if (!Number.isFinite(o.gallery.order)) o.gallery.order = idx;
    if (!(o.gallery.scale > 0)) o.gallery.scale = 1;
    return o.gallery;
  }
  // order を 0..n-1 に詰め直す（並び順を一意に保つ）
  function reindexGal() {
    const arr = list();
    arr.map((o, idx) => ({ o, idx }))
      .sort((a, b) => (a.o.gallery.order - b.o.gallery.order) || (a.idx - b.idx))
      .forEach((rec, i) => { ensureGal(rec.o, rec.idx).order = i; });
  }
  function refreshGList() {
    const wrap = $('#ed-glist'); if (!wrap) return;
    const arr = list();
    arr.forEach((o, idx) => ensureGal(o, idx));
    const ord = arr.map((o, idx) => ({ o, idx }))
      .sort((a, b) => (a.o.gallery.order - b.o.gallery.order) || (a.idx - b.idx));
    wrap.innerHTML = '';
    ord.forEach((rec, pos) => {
      const o = rec.o;
      const it = document.createElement('div');
      it.className = 'objitem' + (rec.idx === sel ? ' sel' : '');
      it.innerHTML =
        `<img src="${o.src}"><span>#${pos + 1}</span>` +
        `<button class="objmove" data-act="gleft"  title="左へ"${pos === 0 ? ' disabled' : ''}>◀</button>` +
        `<button class="objmove" data-act="gright" title="右へ"${pos === ord.length - 1 ? ' disabled' : ''}>▶</button>` +
        `<input type="range" min="0.2" max="2.6" step="0.05" value="${o.gallery.scale}">` +
        `<span class="gsval">${o.gallery.scale.toFixed(2)}</span>`;
      it.addEventListener('click', (e) => {
        if (e.target.classList.contains('objmove') || e.target.tagName === 'INPUT') return;
        sel = rec.idx; refreshAll();
      });
      const lf = it.querySelector('[data-act=gleft]');
      const rt = it.querySelector('[data-act=gright]');
      if (lf) lf.addEventListener('click', () => galMove(ord, pos, -1));
      if (rt) rt.addEventListener('click', () => galMove(ord, pos, +1));
      const rng = it.querySelector('input');
      rng.addEventListener('input', () => {
        o.gallery.scale = parseFloat(rng.value);
        it.querySelector('.gsval').textContent = o.gallery.scale.toFixed(2);
        markDirty();
      });
      wrap.appendChild(it);
    });
  }
  function galMove(ord, pos, dir) {
    const j = pos + dir; if (j < 0 || j >= ord.length) return;
    const a = ord[pos].o.gallery, b = ord[j].o.gallery;
    const t = a.order; a.order = b.order; b.order = t;
    reindexGal(); markDirty(); refreshGList();
  }

  // 編集中の手紙の全オブジェクトを「編集中の状態」で表示
  function paintEdit() {
    const C = ctx[letter];
    // editing クラスを現在の封筒だけに
    ctx.forEach((c) => c.envelopeEl.classList.remove('editing'));
    C.envelopeEl.classList.add('editing');
    C.renderContents();
    const els = C.contentsEl.children;
    list().forEach((o, k) => {
      if (!els[k]) return;
      applyState(els[k], o[stateKey]);
      els[k].classList.toggle('selected', k === sel);
      attachDrag(els[k], k);
      // ステッカーは編集中も見えるよう中ほどにハイライトを置く
      // （旧 background-position-x:50% と同位置。-2*50/3 = -33.333%）
      const bar = els[k].querySelector('.shine-bar');
      if (bar) bar.style.transform = 'translateX(-33.333%)';
    });
    updateGizmo();
  }
  function refreshAll() { refreshList(); refreshControls(); refreshGList(); paintEdit(); }

  function gotoLetter(i) {
    letter = i; sel = -1; stateKey = 'init';
    selLetter.value = i;
    goTo(i + 1); // 表紙ぶん +1
    refreshAll();
  }
  selLetter.addEventListener('change', () => gotoLetter(+selLetter.value));

  // 画像追加（dataURL で埋め込み）
  $('#ed-add').addEventListener('click', () => $('#ed-file').click());
  $('#ed-file').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const init  = defaultState({ y: 60, scale: 0.92 });
      const final = defaultState({ y: 38, scale: 1 });
      list().push({
        src: r.result,
        init, final,
        ctrl: { x: (init.x + final.x) / 2, y: (init.y + final.y) / 2 },
        gallery: { order: list().length, scale: 1 } // 横スクロール展開: 末尾＆等倍
      });
      sel = list().length - 1; stateKey = 'init';
      markDirty(); refreshAll();
    };
    r.readAsDataURL(f);
    e.target.value = '';
  });

  // 状態タブ
  $('#ed-init').addEventListener('click',  () => { stateKey = 'init';  refreshAll(); });
  $('#ed-final').addEventListener('click', () => { stateKey = 'final'; refreshAll(); });

  $('#ed-src').addEventListener('change', () => {
    if (!curObj()) return;
    const v = $('#ed-src').value.trim();
    if (v && !v.startsWith('(')) { curObj().src = v; markDirty(); refreshAll(); }
  });

  $('#ed-sticker').addEventListener('click', () => {
    if (!curObj()) return;
    curObj().sticker = !curObj().sticker;
    markDirty(); refreshAll();
  });

  $('#ed-copystate').addEventListener('click', () => {
    if (!curObj()) return;
    const other = stateKey === 'init' ? 'final' : 'init';
    curObj()[other] = Object.assign({}, curObj()[stateKey]);
    markDirty(); refreshAll();
  });
  $('#ed-dup').addEventListener('click', () => {
    if (!curObj()) return;
    list().splice(sel + 1, 0, JSON.parse(JSON.stringify(curObj())));
    sel++; markDirty(); refreshAll();
  });
  $('#ed-del').addEventListener('click', () => {
    if (!curObj()) return;
    list().splice(sel, 1); sel = Math.min(sel, list().length - 1);
    markDirty(); refreshAll();
  });
  $('#ed-clear').addEventListener('click', () => {
    if (!confirm('この手紙の中身を全て削除します')) return;
    letterContents[letter] = []; sel = -1; markDirty(); refreshAll();
  });

  // 再生: 初期状態にリセットしてから開封アニメ
  $('#ed-play').addEventListener('click', () => {
    ctx[letter].reset();
    ctx[letter].animate(false);
  });

  // 横スクロールギャラリー展開を確認（現在の中身位置から飛ばす）
  $('#ed-gallery').addEventListener('click', () => { openGallery(letter); });

  // ── 手動保存 ──
  let dirty = false;
  function markDirty() {
    dirty = true;
    $('#ed-save').textContent = '保存 — 未保存の変更あり';
  }
  $('#ed-save').addEventListener('click', async () => {
    $('#ed-save').textContent = '保存中…';
    try {
      await saveContents();
      dirty = false;
      $('#ed-save').textContent = '保存しました ✓';
      setTimeout(() => { if (!dirty) $('#ed-save').textContent = '保存'; }, 1500);
    } catch (err) {
      $('#ed-save').textContent = '保存（失敗）';
      alert('保存に失敗しました: ' + err);
    }
  });
  // 未保存のまま離脱しようとしたら警告
  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  $('#ed-export').addEventListener('click', () => {
    const json = JSON.stringify(letterContents, null, 2);
    $('#ed-json').value = json;
    if (navigator.clipboard) navigator.clipboard.writeText(json).then(() => {
      $('#ed-export').textContent = 'コピーしました ✓';
      setTimeout(() => $('#ed-export').textContent = 'JSONコピー', 1500);
    }, () => {});
  });

  // ── 焼き込み用書き出し：埋め込み画像をwebpファイル化し、srcをパス参照に置換 ──
  // data: URL を webp blob に再エンコード（canvas経由）
  function dataUrlToWebp(dataUrl, quality = 0.9) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        cv.getContext('2d').drawImage(img, 0, 0);
        cv.toBlob((b) => b ? res(b) : rej(new Error('webpエンコード失敗')), 'image/webp', quality);
      };
      img.onerror = () => rej(new Error('画像の読み込みに失敗'));
      img.src = dataUrl;
    });
  }

  // data:image/svg+xml の data URL を SVGテキストのBlobに復元（再エンコードしない）
  function svgDataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const meta = dataUrl.slice(5, comma); // "image/svg+xml..." or with ;base64
    const data = dataUrl.slice(comma + 1);
    const isBase64 = /;base64/i.test(meta);
    const text = isBase64 ? atob(data) : decodeURIComponent(data);
    return new Blob([text], { type: 'image/svg+xml' });
  }

  $('#ed-bake').addEventListener('click', async () => {
    const btn = $('#ed-bake');
    const orig = btn.textContent;
    const setLabel = (t) => { btn.textContent = t; };
    try {
      // 1) 保存先フォルダ（assets/contents）を選択
      if (!window.showDirectoryPicker) {
        alert('このブラウザはフォルダ直書き込みに未対応です。Chrome / Edge で開いてください。');
        return;
      }
      setLabel('保存先フォルダ（assets/contents）を選択…');
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });

      // 2) 全手紙を走査し、data: URL を集約（同一画像は1ファイルに集約）
      const slim = JSON.parse(JSON.stringify(letterContents));
      const seen = new Map();   // dataUrl -> "assets/contents/xxx.webp"
      let counter = 0, written = 0;
      const keys = Object.keys(slim);
      for (const k of keys) {
        const arr = slim[k] || [];
        for (const o of arr) {
          if (typeof o.src !== 'string' || !o.src.startsWith('data:')) continue; // 既にパス参照
          if (seen.has(o.src)) { o.src = seen.get(o.src); continue; }
          counter++;
          // SVGはwebpに変換せず、SVGのまま書き出す
          const isSvg = /^data:image\/svg\+xml/i.test(o.src);
          const ext = isSvg ? 'svg' : 'webp';
          const name = `embed${String(counter).padStart(2, '0')}.${ext}`;
          setLabel(`書き出し中… ${name}`);
          const blob = isSvg ? svgDataUrlToBlob(o.src) : await dataUrlToWebp(o.src);
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(blob); await w.close();
          const path = `assets/contents/${name}`;
          seen.set(o.src, path);
          o.src = path;
          written++;
        }
      }

      // 3) 軽量JSONを出力＆コピー
      const json = JSON.stringify(slim, null, 2);
      $('#ed-json').value = json;
      if (navigator.clipboard) { try { await navigator.clipboard.writeText(json); } catch {} }
      setLabel(`✓ 画像${written}枚を保存・JSONをコピー（${json.length.toLocaleString()}字）`);
      alert(`完了しました。\n・画像 ${written} 枚を assets/contents に保存\n・軽量JSON（${json.length.toLocaleString()}字）を下の欄に出力＆コピー\n\nこのJSONを js/config.js の BAKED_CONTENTS = の右辺に貼り付けてください。`);
      setTimeout(() => setLabel(orig), 4000);
    } catch (err) {
      if (err && err.name === 'AbortError') { setLabel(orig); return; } // フォルダ選択キャンセル
      console.error(err);
      alert('書き出しに失敗しました: ' + (err && err.message || err));
      setLabel(orig);
    }
  });

  // ドラッグ移動
  function attachDrag(el, idx) {
    if (el._dragBound) return; el._dragBound = true;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sel = idx; refreshList(); refreshControls();
      [...ctx[letter].contentsEl.children].forEach((c, k) => c.classList.toggle('selected', k === idx));
      const rect = ctx[letter].envelopeEl.getBoundingClientRect();
      const o = list()[idx], st = o[stateKey];
      const sx = e.clientX, sy = e.clientY, ox = st.x, oy = st.y;
      el.setPointerCapture(e.pointerId);
      function move(ev) {
        st.x = ox + (ev.clientX - sx) / rect.width  * 100;
        st.y = oy + (ev.clientY - sy) / rect.height * 100;
        applyState(el, st);
        updateGizmo();
      }
      function up() {
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        markDirty();
      }
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  /* ── 編集ギズモ（バウンディングボックス＋パス制御点を直接操作） ── */
  const NS = 'http://www.w3.org/2000/svg';
  const gizmo = document.createElement('div');
  gizmo.className = 'gizmo';
  const gsvg = document.createElementNS(NS, 'svg');
  gsvg.setAttribute('class', 'path');
  gsvg.setAttribute('viewBox', '0 0 100 100');
  gsvg.setAttribute('preserveAspectRatio', 'none');
  // 制御点から始点/終点へ結ぶガイド線（ベジェハンドル）。曲線本体より薄く
  const gGuide = document.createElementNS(NS, 'path');
  gGuide.setAttribute('fill', 'none');
  gGuide.setAttribute('stroke', '#208FDB');
  gGuide.setAttribute('stroke-width', '0.4');
  gGuide.setAttribute('stroke-dasharray', '1 1.5');
  gGuide.setAttribute('stroke-linecap', 'round');
  gGuide.setAttribute('opacity', '0.5');
  gsvg.appendChild(gGuide);
  const gPath = document.createElementNS(NS, 'path');
  gPath.setAttribute('fill', 'none');
  gPath.setAttribute('stroke', '#208FDB');
  gPath.setAttribute('stroke-width', '0.5');
  gPath.setAttribute('stroke-dasharray', '1.5 1.5');
  gPath.setAttribute('stroke-linecap', 'round');
  gsvg.appendChild(gPath);
  // 選択オブジェクトを囲うボックス。四隅=拡縮 / 上のノブ=回転
  const gBox = document.createElement('div');
  gBox.className = 'g-box';
  const gCorners = ['nw', 'ne', 'se', 'sw'].map((pos) => {
    const h = document.createElement('div');
    h.className = `g-corner g-${pos}`;
    h.title = '拡縮';
    gBox.appendChild(h);
    return h;
  });
  const gRot = Object.assign(document.createElement('div'), { className: 'g-rot', title: '回転' });
  gBox.appendChild(gRot);
  const gCtrl = Object.assign(document.createElement('div'), { className: 'g-ctrl', title: 'パスの曲がり' });
  gizmo.append(gsvg, gBox, gCtrl);

  function updateGizmo() {
    const o = curObj(), el = selEl();
    if (!o || !el) { gizmo.style.display = 'none'; return; }
    gizmo.style.display = '';
    const env = ctx[letter].envelopeEl;
    if (gizmo.parentNode !== env) env.appendChild(gizmo);
    const s = curState(), a = o.init, b = o.final;
    const c = o.ctrl || (o.ctrl = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    // 移動パス（init → ctrl → final）＋ 制御点から始点/終点へのガイド線
    gPath.setAttribute('d', `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`);
    gGuide.setAttribute('d', `M ${a.x} ${a.y} L ${c.x} ${c.y} L ${b.x} ${b.y}`);
    // 画像ロード前は offsetHeight が 0 のため、ロード完了時に再計算
    const img = el.querySelector('img');
    if (img && !img.complete) img.addEventListener('load', updateGizmo, { once: true });
    // ボックス: 未変形サイズ×scale を中心 (x,y)% に置き、回転は transform で反映
    gBox.style.width  = el.offsetWidth  * s.scale + 'px';
    gBox.style.height = el.offsetHeight * s.scale + 'px';
    gBox.style.left = s.x + '%';
    gBox.style.top  = s.y + '%';
    gBox.style.transform = `translate(-50%, -50%) rotate(${s.rot}deg)`;
    gCtrl.style.left = c.x + '%'; gCtrl.style.top = c.y + '%';
  }

  const rectOf = () => ctx[letter].envelopeEl.getBoundingClientRect();
  const centerPx = (st, r) => ({ x: r.left + st.x / 100 * r.width, y: r.top + st.y / 100 * r.height });
  const selEl = () => ctx[letter].contentsEl.children[sel];

  // 回転ハンドル
  gRot.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const o = curObj(); if (!o) return;
    const st = curState(), r = rectOf(), c0 = centerPx(st, r);
    const startAng = Math.atan2(e.clientY - c0.y, e.clientX - c0.x);
    const startRot = st.rot;
    gRot.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const ang = Math.atan2(ev.clientY - c0.y, ev.clientX - c0.x);
      st.rot = startRot + (ang - startAng) * 180 / Math.PI;
      applyState(selEl(), st); updateGizmo();
    };
    const up = () => { gRot.releasePointerCapture(e.pointerId);
      gRot.removeEventListener('pointermove', move); gRot.removeEventListener('pointerup', up);
      markDirty(); };
    gRot.addEventListener('pointermove', move); gRot.addEventListener('pointerup', up);
  });

  // 四隅の拡縮ハンドル（中心からの距離比でスケール）
  gCorners.forEach((h) => h.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const o = curObj(); if (!o) return;
    const st = curState(), r = rectOf(), c0 = centerPx(st, r);
    const startDist = Math.hypot(e.clientX - c0.x, e.clientY - c0.y) || 1;
    const startScale = st.scale;
    h.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const d = Math.hypot(ev.clientX - c0.x, ev.clientY - c0.y);
      st.scale = Math.max(0.05, startScale * d / startDist);
      applyState(selEl(), st); updateGizmo();
    };
    const up = () => { h.releasePointerCapture(e.pointerId);
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up);
      markDirty(); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  }));

  // パス制御点ハンドル
  gCtrl.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const o = curObj(); if (!o) return;
    const r = rectOf();
    gCtrl.setPointerCapture(e.pointerId);
    const move = (ev) => {
      o.ctrl.x = (ev.clientX - r.left) / r.width  * 100;
      o.ctrl.y = (ev.clientY - r.top)  / r.height * 100;
      updateGizmo();
    };
    const up = () => { gCtrl.releasePointerCapture(e.pointerId);
      gCtrl.removeEventListener('pointermove', move); gCtrl.removeEventListener('pointerup', up);
      markDirty(); };
    gCtrl.addEventListener('pointermove', move); gCtrl.addEventListener('pointerup', up);
  });

  // IndexedDBの非同期ロード完了時にエディタを再描画するためのフック
  editorRefresh = () => { sel = -1; refreshAll(); };

  gotoLetter(0); // 起動
}
