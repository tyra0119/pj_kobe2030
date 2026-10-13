// 車なしで暮らせる度マップ（神戸市北区・三田市）
// data/cells.json の 1 行 = 人口のある 250m メッシュ 1 つ。
//   [西経, 南緯, 人口, 65歳以上, 75歳以上, 標高, 坂なし×4, 坂あり×4, 帰りの上り×4, 地域]
//   地域は meta.areas の番号（0 神戸市北区・1 三田市）
//   ×4 は 乗り場（バス停・駅）・スーパー・病院診療所・小学校 までの道のり（m）

const KINDS = ['stop', 'super', 'clinic', 'school'];
const KIND_NAME = { stop: 'バス停・駅', super: 'スーパー', clinic: '病院・診療所', school: '小学校' };
const LEVELS = {
  walk: { name: '歩いて暮らせる', desc: 'スーパーと病院・診療所の両方まで歩ける', color: '#1a9e77' },
  bus: { name: 'バス・電車が近い', desc: '歩ける所にバス停か駅がある（本数は未反映）', color: '#f2b134' },
  car: { name: '車がないと難しい', desc: '歩ける所にバス停も駅もない', color: '#d1495b' },
};
// 1 つの施設だけを見るときの色（分）
const STEPS = [
  { max: 5, color: '#1a9e77', name: '5分以内' },
  { max: 10, color: '#7cc47a', name: '10分以内' },
  { max: 15, color: '#f2b134', name: '15分以内' },
  { max: 20, color: '#ee7d3b', name: '20分以内' },
  { max: Infinity, color: '#d1495b', name: '20分より先' },
];
// 北区と三田市を合わせた範囲
const AREA_BOUNDS = [[135.03, 34.70], [135.32, 35.04]];
const fitPadding = () => (matchMedia('(max-width: 640px)').matches
  ? { top: 70, bottom: 20, left: 20, right: 60 }
  : { top: 30, bottom: 30, left: 370, right: 70 });

const state = { mode: 'all', mins: 10, speed: 80, slope: 1, area: 'all' };
let data, meta, stops, selected = null;

// パネルはスマホでははじめたたむ。自分で開け閉めしたあとは触らない
const panelBox = document.getElementById('panel-box');
let panelTouched = false;
panelBox.querySelector('summary').addEventListener('click', () => (panelTouched = true));
const fitPanel = () => {
  if (!panelTouched) panelBox.open = !matchMedia('(max-width: 640px)').matches;
};
fitPanel();

// ---------- 地図 ----------
const map = new maplibregl.Map({
  container: 'map',
  // 背景は こうづだい暮らしナビ（kozdai の map.html）と同じ OpenStreetMap 標準の地図
  // （2026-10-13 利用者「以下のURLで使用している地図に変更して https://tyra.jp/kozdai/map.html」）。
  // 利用規約: https://operations.osmfoundation.org/policies/tiles/ 。出典の表示が要る
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  },
  bounds: AREA_BOUNDS,
  fitBoundsOptions: { padding: fitPadding() },
  maxZoom: 18,
  minZoom: 8,
  attributionControl: { compact: true, customAttribution: '国土数値情報・国勢調査（e-Stat）・地理院タイル（標高）・OSM から作成' },
});
window.map = map; // 調べもの用
// 隠れているあいだに窓の大きさが変わると、地図が前の大きさのまま残ることがある。
// まだ地図を触っていなければ、北区と三田市の全体が入るように合わせ直す
let userMoved = false;
map.on('movestart', (e) => { if (e.originalEvent) userMoved = true; });
const fitCanvas = () => {
  fitPanel();
  if (map.getCanvas().clientWidth !== map.getContainer().clientWidth) map.resize();
  if (!userMoved && !selected) map.fitBounds(AREA_BOUNDS, { padding: fitPadding(), animate: false });
};
addEventListener('resize', fitCanvas);
document.addEventListener('visibilitychange', fitCanvas);
// 操作は Google マップと同じ（左ドラッグ移動・右ドラッグ回転・ホイール拡大縮小、
// 指 1 本移動、2 本でひねり回転・ピンチ拡大縮小・平行移動・上下で傾き）。MapLibre の標準のまま使う

// ---------- 地図のボタン ----------
const ICON = {
  compass: '<svg viewBox="0 0 24 24"><path d="M12 2l4 10h-8z" fill="#d1495b"/><path d="M12 22l-4-10h8z" fill="currentColor" opacity=".55"/></svg>',
  locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>',
  plus: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
};

function group(buttons) {
  const box = document.createElement('div');
  box.className = 'maplibregl-ctrl mbtn-group';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'mbtn';
    el.type = 'button';
    el.title = b.title;
    el.setAttribute('aria-label', b.title);
    el.innerHTML = b.icon;
    el.addEventListener('click', () => b.onClick(el));
    box.appendChild(el);
    b.el = el;
  }
  return box;
}

const compassBtn = { title: '北を上にする', icon: ICON.compass, onClick: () => map.easeTo({ bearing: 0, pitch: 0 }) };
const locateBtn = { title: '現在地', icon: ICON.locate, onClick: locate };
const zoomIn = { title: '拡大', icon: ICON.plus, onClick: () => map.zoomIn() };
const zoomOut = { title: '縮小', icon: ICON.minus, onClick: () => map.zoomOut() };

// 右下の角は、あとから足したものが上に積まれる。下から 縮小・拡大 → 現在地 → 方角 の順に足す
map.addControl({ onAdd: () => group([zoomIn, zoomOut]), onRemove() {} }, 'bottom-right');
map.addControl({ onAdd: () => group([locateBtn]), onRemove() {} }, 'bottom-right');
map.addControl({ onAdd: () => group([compassBtn]), onRemove() {} }, 'bottom-right');
map.addControl(new maplibregl.FullscreenControl({ container: document.body }), 'top-right');

const turnCompass = () => {
  compassBtn.el.firstChild.style.transform = `rotate(${-map.getBearing()}deg)`;
};
map.on('rotate', turnCompass);

let me = null;
function locate(btn) {
  // 現在地が取れないときは、選んでいるメッシュ、それもなければ北区と三田市の全体を出す
  const fallback = (why) => {
    if (selected) map.easeTo({ center: selected, zoom: Math.max(map.getZoom(), 14) });
    else map.fitBounds(AREA_BOUNDS, { padding: fitPadding() });
    message(`${why}。${selected ? '選んでいる場所' : '北区と三田市の全体'}を表示します`);
  };
  if (!navigator.geolocation) return fallback('現在地が使えません');
  btn.classList.add('busy');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.classList.remove('busy');
      const ll = [pos.coords.longitude, pos.coords.latitude];
      if (!me) {
        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#0b6bcb;border:3px solid #fff;box-shadow:0 0 0 2px rgba(11,107,203,.35)';
        me = new maplibregl.Marker({ element: el });
      }
      me.setLngLat(ll).addTo(map);
      map.easeTo({ center: ll, zoom: Math.max(map.getZoom(), 15) });
      const [[w, s], [e, n]] = AREA_BOUNDS;
      if (ll[0] < w || ll[0] > e || ll[1] < s || ll[1] > n) message('いまの場所は北区・三田市の外です（色分けは北区と三田市だけ）');
    },
    () => {
      btn.classList.remove('busy');
      fallback('現在地が取れませんでした');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

let msgTimer;
function message(text) {
  let el = document.querySelector('.msg');
  if (!el) {
    el = document.createElement('div');
    el.className = 'msg';
    document.body.appendChild(el);
  }
  el.textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => el.remove(), 4000);
}

// ---------- 判定 ----------
function dists(r) {
  const o = state.slope ? 10 : 6;
  return { stop: r[o], super: r[o + 1], clinic: r[o + 2], school: r[o + 3] };
}
function climbs(r) {
  return { stop: r[14], super: r[15], clinic: r[16], school: r[17] };
}
function level(r) {
  const T = state.mins * state.speed;
  const d = dists(r);
  if (d.super <= T && d.clinic <= T) return 'walk';
  if (d.stop <= T) return 'bus';
  return 'car';
}
function minutes(m) {
  return m / state.speed;
}
function stepOf(min) {
  return STEPS.find((s) => min <= s.max);
}
function colorOf(r) {
  if (state.mode === 'all') return LEVELS[level(r)].color;
  return stepOf(minutes(dists(r)[state.mode])).color;
}

// ---------- データ ----------
// 公開ページ（GitHub Pages）はファイルを 10 分間ブラウザに残させるので、書き出すたびに付く版の印（app.js?v=…）を
// データにも付けて、古いデータが使われないようにする（scripts/publish.js）
const VER = new URL(document.currentScript?.src || location.href).searchParams.get('v') || '';
const load = (path) => fetch(VER ? `${path}?v=${VER}` : path).then((r) => r.json());
Promise.all([
  load('data/cells.json'),
  load('data/stops.geojson'),
  load('data/facilities.geojson'),
  load('data/boundary.geojson'),
  load('data/did.geojson'),
  new Promise((ok) => (map.isStyleLoaded() ? ok() : map.once('style.load', ok))),
]).then(([cells, stopsFc, facFc, boundary, did]) => {
  data = cells.cells;
  meta = cells.meta;
  stops = stopsFc.features;
  // 画面の大きさが決まってから、全体が入るように合わせ直す（まだ触っていなければ）
  fitCanvas();

  map.addSource('cells', { type: 'geojson', data: cellsFc() });
  map.addSource('boundary', { type: 'geojson', data: boundary });
  map.addSource('did', { type: 'geojson', data: did });
  // バス停・駅は、色分けしたメッシュから歩いて行ける所（約 1km 以内）のものだけ出す。
  // 距離の計算には外のものも使っているが、出すと神戸の市街地まで点だらけになる
  const near = new Set();
  for (const r of data) {
    const lon = r[0] + meta.dlon / 2, lat = r[1] + meta.dlat / 2;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    stopsFc.features.forEach((f, j) => {
      if (near.has(j)) return;
      const [x, y] = f.geometry.coordinates;
      if (Math.abs(x - lon) * kx < 1000 && Math.abs(y - lat) * 110950 < 1000) near.add(j);
    });
  }
  stopsFc.features.forEach((f, j) => (f.properties.near = near.has(j)));
  map.addSource('stops', { type: 'geojson', data: stopsFc });
  map.addSource('mask', { type: 'geojson', data: maskFc(boundary) });
  map.addSource('fac', { type: 'geojson', data: facFc });

  map.addLayer({
    id: 'cells', type: 'fill', source: 'cells',
    // fill-antialias を切ると、となりのメッシュとの間の白い細い線が出ない
    paint: {
      'fill-color': ['get', 'color'], 'fill-antialias': false,
      // 拡大するほど薄くして、道や町名が透けて見えるように
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.78, 12, 0.65, 14, 0.42, 16, 0.28],
    },
  });
  map.addLayer({
    id: 'cells-sel', type: 'line', source: 'cells', filter: ['==', ['get', 'i'], -1],
    paint: { 'line-color': '#111', 'line-width': 2.5 },
  });
  map.addLayer({
    id: 'did', type: 'line', source: 'did', layout: { visibility: 'none' },
    paint: { 'line-color': '#6b4fbb', 'line-width': 1.6, 'line-dasharray': [2, 1.5] },
  });
  // 対象（北区・三田市）の外を白く覆い、境目を太く
  map.addLayer({ id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.55 } }, 'cells');
  map.addLayer({
    id: 'boundary-casing', type: 'line', source: 'boundary',
    paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'boundary', type: 'line', source: 'boundary',
    paint: { 'line-color': '#3b4250', 'line-width': 2.2 },
  });
  map.addLayer({
    id: 'stops-bus', type: 'circle', source: 'stops', minzoom: 13,
    filter: ['all', ['==', ['get', 'kind'], 'bus'], ['get', 'near']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 16, 5],
      'circle-color': '#ffffff', 'circle-stroke-color': '#0b6bcb', 'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'stops-rail', type: 'circle', source: 'stops',
    filter: ['all', ['==', ['get', 'kind'], 'rail'], ['get', 'near']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
      'circle-color': '#222', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
    },
  });
  const facColor = { super: '#e07b00', clinic: '#c2185b', school: '#2e7d32' };
  for (const t of ['super', 'clinic', 'school']) {
    map.addLayer({
      id: `fac-${t}`, type: 'circle', source: 'fac', filter: ['==', ['get', 'type'], t],
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
        'circle-color': facColor[t], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
      },
    });
  }

  // 点（バス停・駅・施設）を先に見て、無ければメッシュ
  const POINT_LAYERS = ['stops-rail', 'stops-bus', 'fac-super', 'fac-clinic', 'fac-school'];
  map.on('click', (e) => {
    const box = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]];
    const visible = POINT_LAYERS.filter((id) => map.getLayoutProperty(id, 'visibility') !== 'none');
    const pt = map.queryRenderedFeatures(box, { layers: visible })[0];
    if (pt) return showPoint(pt, e.lngLat);
    const cell = map.queryRenderedFeatures(e.point, { layers: ['cells'] })[0];
    if (cell) showCell(cell.properties.i, e.lngLat);
    else if (popup) popup.remove();
  });
  for (const id of POINT_LAYERS) {
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
  }
  map.on('mouseenter', 'cells', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'cells', () => (map.getCanvas().style.cursor = ''));

  render();
});

// 対象の外を覆う形: 広い四角から、北区・三田市の形をくり抜く
function maskFc(boundary) {
  const holes = boundary.features.flatMap((f) => f.geometry.coordinates.map((poly) => poly[0]));
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [[[133, 33], [137, 33], [137, 36.5], [133, 36.5], [133, 33]], ...holes] },
    }],
  };
}

function cellsFc() {
  return {
    type: 'FeatureCollection',
    features: data.map((r, i) => {
      const [w, s] = r;
      const e = w + meta.dlon, n = s + meta.dlat;
      return {
        type: 'Feature',
        properties: { i, color: colorOf(r) },
        geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      };
    }),
  };
}

// ---------- 画面 ----------
function render() {
  if (!data) return;
  map.getSource('cells').setData(cellsFc());
  renderLegend();
  renderStats();
  if (popup && popup.isOpen() && popupCell != null) showCell(popupCell, popup.getLngLat());
}

function renderLegend() {
  const el = document.getElementById('legend');
  const items = state.mode === 'all'
    ? Object.values(LEVELS).map((l) => ({ color: l.color, text: `<b>${l.name}</b> <span class="cap">${l.desc}</span>` }))
    : STEPS.map((s) => ({ color: s.color, text: `${KIND_NAME[state.mode]}まで ${s.name}` }));
  el.innerHTML = items.map((i) => `<div class="item"><span class="sw" style="background:${i.color}"></span><span>${i.text}</span></div>`).join('');
}

function renderStats() {
  const el = document.getElementById('stats');
  // 内訳は選んだ地域（合計・北区・三田市）の分だけ数える
  const rows = state.area === 'all' ? data : data.filter((r) => r[18] === state.area);
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const areaName = state.area === 'all' ? meta.areas.join('・') : meta.areas[state.area];
  const total = sum((r) => r[2]);
  const total65 = sum((r) => r[3]);
  let groups;
  if (state.mode === 'all') {
    groups = Object.entries(LEVELS).map(([k, l]) => ({
      name: l.name, color: l.color,
      pop: sum((r) => (level(r) === k ? r[2] : 0)),
      old: sum((r) => (level(r) === k ? r[3] : 0)),
    }));
  } else {
    groups = STEPS.map((s) => ({
      name: s.name, color: s.color,
      pop: sum((r) => (stepOf(minutes(dists(r)[state.mode])) === s ? r[2] : 0)),
      old: sum((r) => (stepOf(minutes(dists(r)[state.mode])) === s ? r[3] : 0)),
    }));
  }
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '0.0') + '%';
  const bar = (key, tot) => `<div class="bar">${groups.map((g) => `<span style="width:${(g[key] / tot) * 100}%;background:${g.color}" title="${g.name} ${pct(g[key], tot)}"></span>`).join('')}</div>`;
  el.innerHTML = `
    <div class="label">${areaName}の人口 ${total.toLocaleString()}人（2020年）のうち</div>
    ${bar('pop', total)}
    <div class="cap">65歳以上 ${total65.toLocaleString()}人では</div>
    ${bar('old', total65)}
    <table>
      <tr><td></td><td class="n cap">全体</td><td class="n cap">65歳以上</td></tr>
      ${groups.map((g) => `<tr><td><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${g.color};margin-right:6px"></span>${g.name}</td><td class="n">${pct(g.pop, total)}</td><td class="n">${pct(g.old, total65)}</td></tr>`).join('')}
    </table>`;
}

let popup = null, popupCell = null;
function openPopup(lngLat, html) {
  // closeOnClick は切る。入れたままだと、別の場所を押したとき新しい中身を出した直後に閉じてしまい、
  // 2 回押さないと開かなかった（2026-10-13 利用者）。何もない所を押したときは地図の click で閉じる
  if (!popup) {
    popup = new maplibregl.Popup({ maxWidth: '320px', focusAfterOpen: false, closeOnClick: false });
    popup.on('close', () => {
      popupCell = null;
      map.setFilter('cells-sel', ['==', ['get', 'i'], -1]);
    });
  }
  popup.setLngLat(lngLat).setHTML(html);
  // 開いているときに addTo し直すと、いったん閉じて close が走る（選んだマスの枠が消える）ので、閉じているときだけ
  if (!popup.isOpen()) popup.addTo(map);
}

function fmtMin(m) {
  if (m >= meta.maxd) return `${Math.floor(meta.maxd / state.speed)}分より先`;
  return `${Math.max(1, Math.round(minutes(m)))}分`;
}

function showCell(i, lngLat) {
  const r = data[i];
  popupCell = i;
  selected = [r[0] + meta.dlon / 2, r[1] + meta.dlat / 2];
  map.setFilter('cells-sel', ['==', ['get', 'i'], i]);
  const lv = LEVELS[level(r)];
  const d = dists(r), up = climbs(r);
  const rows = KINDS.map((k) => {
    const upTxt = state.slope && up[k] >= 5 ? `<span class="up">（帰りに${up[k]}m上る）</span>` : '';
    return `<tr><td>${KIND_NAME[k]}まで${upTxt}</td><td class="n">歩いて約${fmtMin(d[k])}</td></tr>`;
  }).join('');
  const near = nearStops(selected, state.mins * state.speed);
  const nearHtml = near.length
    ? near.map((s) => `<div>${s.name} <span class="op">${s.op}${s.routes ? '・' + s.routes : ''}</span></div>`).join('')
    : '<div class="op">なし</div>';
  openPopup(lngLat, `<div class="pop">
    <span class="lv" style="background:${lv.color}">${lv.name}</span>
    <table>
      <tr><td>地域</td><td class="n">${meta.areas[r[18]]}</td></tr>
      <tr><td>人口</td><td class="n">${r[2].toLocaleString()}人（65歳以上 ${r[2] ? Math.round((r[3] / r[2]) * 100) : 0}%）</td></tr>
      <tr><td>標高</td><td class="n">約${r[5]}m</td></tr>
      ${rows}
    </table>
    <div class="stops"><div class="cap">歩いて${state.mins}分ほどの所のバス停・駅（坂なしの目安）</div>${nearHtml}</div>
  </div>`);
}

function nearStops([lon, lat], T) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110950;
  const byName = new Map();
  for (const f of stops) {
    const [x, y] = f.geometry.coordinates;
    const dm = Math.hypot((x - lon) * kx, (y - lat) * ky) * meta.detour;
    if (dm > T) continue;
    const p = f.properties;
    const key = `${p.name}|${p.op}`;
    const routes = (typeof p.routes === 'string' ? JSON.parse(p.routes) : p.routes) || [];
    const cur = byName.get(key);
    if (!cur || dm < cur.dm) byName.set(key, { name: p.name, op: p.kind === 'rail' ? `${p.op} ${p.line}` : p.op, routes: routes.join('、'), dm });
  }
  return [...byName.values()].sort((a, b) => a.dm - b.dm).slice(0, 12);
}

function showPoint(f, lngLat) {
  const p = f.properties;
  let html;
  if (p.kind) {
    const routes = (typeof p.routes === 'string' ? JSON.parse(p.routes) : p.routes) || [];
    html = `<div class="pop"><h3>${p.name}</h3><div class="op">${p.kind === 'rail' ? p.op + ' ' + p.line : p.op}</div>${routes.length ? `<div class="stops">${routes.map((r) => `<div>${r}</div>`).join('')}</div>` : ''}</div>`;
  } else {
    html = `<div class="pop"><h3>${p.name}</h3><div class="op">${p.sub || KIND_NAME[p.type]}</div></div>`;
  }
  popupCell = null;
  map.setFilter('cells-sel', ['==', ['get', 'i'], -1]);
  openPopup(lngLat, html);
}

// ---------- この地図について ----------
// 初めて開いたときだけ出す。閉じたことはブラウザに覚える（覚えられないときは毎回出る）
const INTRO_KEY = 'kobe2030.introSeen';
const intro = document.getElementById('intro');
function openIntro() {
  intro.hidden = false;
  // ボタンに移すと一番下まで流れるので、上から読めるように戻す
  document.getElementById('intro-close').focus({ preventScroll: true });
  intro.querySelector('.intro-box').scrollTop = 0;
}
function closeIntro() {
  intro.hidden = true;
  try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* 覚えられなくても閉じる */ }
}
document.getElementById('intro-close').addEventListener('click', closeIntro);
document.getElementById('about-open').addEventListener('click', openIntro);
intro.addEventListener('click', (e) => { if (e.target === intro) closeIntro(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !intro.hidden) closeIntro(); });
let seen = false;
try { seen = localStorage.getItem(INTRO_KEY) === '1'; } catch (e) { /* 覚えられない */ }
if (!seen) openIntro();

// ---------- 設定 ----------
function seg(id, key, conv = (v) => v) {
  const box = document.getElementById(id);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    state[key] = conv(b.dataset.v);
    render();
  });
}
seg('mode', 'mode');
seg('speed', 'speed', Number);
seg('slope', 'slope', Number);
seg('area', 'area', (v) => (v === 'all' ? 'all' : Number(v)));

const minsEl = document.getElementById('mins');
minsEl.addEventListener('input', () => {
  state.mins = Number(minsEl.value);
  document.getElementById('mins-out').textContent = `${state.mins}分`;
  render();
});

const LAYER_IDS = {
  stops: ['stops-bus', 'stops-rail'], super: ['fac-super'], clinic: ['fac-clinic'], school: ['fac-school'], did: ['did'],
};
document.querySelectorAll('[data-layer]').forEach((cb) => {
  cb.addEventListener('change', () => {
    for (const id of LAYER_IDS[cb.dataset.layer]) map.setLayoutProperty(id, 'visibility', cb.checked ? 'visible' : 'none');
  });
});
