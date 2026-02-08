import CMapRenderer from './CMapRenderer.js';
import CWebMapLoader from './CWebMapLoader.js';

const viewport = document.getElementById('viewport');
const overlayCanvas = document.getElementById('overlayCanvas');
const webMapIn = document.getElementById('webMapIn');

let g_pWebMap = null;
let g_renderer = new CMapRenderer(viewport);

let g_nHoverX = -1, g_nHoverY = -1;
let g_bShowAccessGrid = true, g_bShowPortals = true, g_bShowEffects = true, g_bShowSounds = true;
let g_bShowCovers = true, g_bShowScenes = true;
let g_bDirty = true;

let g_vecAccessBits = null;
let g_flMouseX = 0, g_flMouseY = 0;

let g_bIsDragging = false;
let g_flDragStartX = 0, g_flDragStartY = 0;

let g_flLastTime = 0, g_nFrames = 0, g_flFpsAccum = 0, g_flFPS = 0;

let g_openMenu = null;

function HasMap() { return g_renderer.m_bWebMapMode; }
function GetMapW() { return g_renderer.m_nMapW; }
function GetMapH() { return g_renderer.m_nMapH; }

async function OpenWebMap(fileList) {
  const loader = new CWebMapLoader();
  if (!(await loader.Load(fileList))) return;
  _ActivateMap(loader);
}

async function OpenWebMapFromUrl(szBaseUrl) {
  const loader = new CWebMapLoader();
  if (!(await loader.LoadFromUrl(szBaseUrl))) return false;
  _ActivateMap(loader);
  return true;
}

function _DecodeAccessBits(szB64, nW, nH) {
  const szChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const vecLookup = new Uint8Array(128);
  for (let i = 0; i < szChars.length; i++) vecLookup[szChars.charCodeAt(i)] = i;

  const nRawLen = (szB64.length * 3) / 4
    - (szB64[szB64.length - 1] === '=' ? 1 : 0)
    - (szB64[szB64.length - 2] === '=' ? 1 : 0);
  const vecBytes = new Uint8Array(nRawLen);
  let nOut = 0;
  for (let i = 0; i < szB64.length; i += 4) {
    const a = vecLookup[szB64.charCodeAt(i)];
    const b = vecLookup[szB64.charCodeAt(i + 1)];
    const c = vecLookup[szB64.charCodeAt(i + 2)];
    const d = vecLookup[szB64.charCodeAt(i + 3)];
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (nOut < nRawLen) vecBytes[nOut++] = (n >> 16) & 0xFF;
    if (nOut < nRawLen) vecBytes[nOut++] = (n >> 8) & 0xFF;
    if (nOut < nRawLen) vecBytes[nOut++] = n & 0xFF;
  }
  return vecBytes;
}

function _IsBlocked(nX, nY) {
  if (!g_vecAccessBits || !g_pWebMap) return false;
  const nW = g_pWebMap.m_manifest.size.w;
  const nBitIdx = nY * nW + nX;
  return (g_vecAccessBits[nBitIdx >> 3] >> (7 - (nBitIdx & 7))) & 1;
}

function _ActivateMap(loader) {
  g_pWebMap = loader;
  g_nHoverX = -1;
  g_nHoverY = -1;

  const m = loader.m_manifest;
  if (m.accessB64) {
    g_vecAccessBits = _DecodeAccessBits(m.accessB64, m.size.w, m.size.h);
  } else {
    g_vecAccessBits = null;
  }

  g_renderer.BuildWebMap(m, loader.m_atlasTextures, loader.m_spriteTextures);
  PopulateWebMapItems(m);

  document.getElementById('noFile').style.display = 'none';
  document.getElementById('webMapInfo').style.display = '';
  document.getElementById('webMapObjects').style.display = '';
  EnableMenus(true);
  g_bDirty = true;
  FitToView();
  UpdateStatus();
}

function GoToCell(nX, nY) {
  if (!HasMap()) return;
  const nW = GetMapW();
  const nH = GetMapH();
  nX = Math.max(0, Math.min(nW - 1, nX));
  nY = Math.max(0, Math.min(nH - 1, nY));
  g_renderer.CenterOnCell(nX, nY);
  g_bDirty = true;
}

function GoToWorldPos(nWx, nWy) {
  if (!g_renderer.m_bWebMapMode) return;
  const coord = g_pWebMap.m_manifest.coord;
  const flThreeX = (nWx - coord.bgWorldX) - g_renderer.m_nBgW / 2;
  const flThreeY = g_renderer.m_nBgH / 2 - (nWy - coord.bgWorldY);
  g_renderer.SetCamera(flThreeX, flThreeY, Math.max(g_renderer.m_flZoom, 0.5));
  g_bDirty = true;
  UpdateStatus();
}

function PopulateWebMapItems(manifest) {
  const nPortals = (manifest.portals || []).length;
  const nEffects = (manifest.effects || []).length;
  const nSounds = (manifest.sounds || []).length;
  const nCovers = (manifest.covers || []).length;
  const nScenes = (manifest.scenes || []).length;

  document.getElementById('mapInfoContent').innerHTML =
    `Name: ${manifest.name || '—'}<br>` +
    `Size: ${manifest.size.w} x ${manifest.size.h}<br>` +
    `Puzzle: ${manifest.puzzle.cols}x${manifest.puzzle.rows} (${manifest.puzzle.tilePx}px)<br>` +
    `Bg: ${manifest.puzzle.bgW}x${manifest.puzzle.bgH}px<br>` +
    `<hr class="imgui-separator">` +
    `Portals: ${nPortals}<br>` +
    `Effects: ${nEffects}<br>` +
    `Sounds: ${nSounds}<br>` +
    `Covers: ${nCovers}<br>` +
    `Scenes: ${nScenes}`;

  _BuildObjList('objPortals', manifest.portals || [], (p, i) => ({
    szInfo: `ID ${p.id}`, szPos: `(${p.x}, ${p.y})`,
    fnGo: () => GoToCell(p.x, p.y)
  }));

  _BuildObjList('objEffects', manifest.effects || [], (e, i) => ({
    szInfo: e.name, szPos: `(${e.wx}, ${e.wy})`,
    fnGo: () => GoToWorldPos(e.wx, e.wy)
  }));

  _BuildObjList('objSounds', manifest.sounds || [], (s, i) => ({
    szInfo: `${s.file} v${s.vol} r${s.range}`, szPos: `(${s.wx}, ${s.wy})`,
    fnGo: () => GoToWorldPos(s.wx, s.wy)
  }));

  _BuildObjList('objCovers', manifest.covers || [], (c, i) => ({
    szInfo: c.sprite.split('/').pop(), szPos: `(${c.tileX}, ${c.tileY})`,
    fnGo: () => GoToCell(c.tileX, c.tileY)
  }));

  _BuildObjList('objScenes', manifest.scenes || [], (s, i) => ({
    szInfo: `${(s.parts || []).length} parts`, szPos: `(${s.tileX}, ${s.tileY})`,
    fnGo: () => GoToCell(s.tileX, s.tileY)
  }));
}

function _BuildObjList(szContainerId, vecItems, fnMapper) {
  const container = document.getElementById(szContainerId);
  if (vecItems.length === 0) {
    container.innerHTML = '<div class="obj-empty">None</div>';
    return;
  }
  let szHtml = '';
  for (let i = 0; i < vecItems.length; i++) {
    const item = fnMapper(vecItems[i], i);
    szHtml += `<div class="obj-row" data-objidx="${i}">` +
      `<span class="obj-idx">${i}</span>` +
      `<span class="obj-info" title="${item.szInfo}">${item.szInfo}</span>` +
      `<span class="obj-pos">${item.szPos}</span>` +
      `<button class="obj-go">Go</button>` +
      `</div>`;
  }
  container.innerHTML = szHtml;

  container.querySelectorAll('.obj-go').forEach((btn, i) => {
    const item = fnMapper(vecItems[i], i);
    btn.addEventListener('click', (e) => { e.stopPropagation(); item.fnGo(); });
  });

  container.querySelectorAll('.obj-row').forEach((row, i) => {
    const item = fnMapper(vecItems[i], i);
    row.addEventListener('dblclick', () => item.fnGo());
  });
}

function CenterMap() {
  if (!HasMap()) return;
  GoToCell((GetMapW() / 2) | 0, (GetMapH() / 2) | 0);
}

function FitToView() {
  if (!HasMap()) return;
  const nVW = viewport.clientWidth;
  const nVH = viewport.clientHeight;
  const flZoom = Math.min(nVW / g_renderer.m_nBgW, nVH / g_renderer.m_nBgH) * 0.95;
  g_renderer.SetCamera(0, 0, flZoom);
  g_bDirty = true;
  UpdateStatus();
}

viewport.addEventListener('mousedown', (e) => {
  if (!HasMap()) return;
  if (e.button === 2) {
    g_bIsDragging = true;
    g_flDragStartX = e.clientX;
    g_flDragStartY = e.clientY;
    viewport.style.cursor = 'grabbing';
  }
});

viewport.addEventListener('mousemove', (e) => {
  if (!HasMap()) return;
  const rect = viewport.getBoundingClientRect();
  const flX = e.clientX - rect.left;
  const flY = e.clientY - rect.top;
  g_flMouseX = flX;
  g_flMouseY = flY;

  if (g_bIsDragging) {
    const flDx = (e.clientX - g_flDragStartX) / g_renderer.m_flZoom;
    const flDy = (e.clientY - g_flDragStartY) / g_renderer.m_flZoom;
    g_flDragStartX = e.clientX;
    g_flDragStartY = e.clientY;
    g_renderer.SetCamera(
      g_renderer.m_flCamX - flDx,
      g_renderer.m_flCamY + flDy,
      g_renderer.m_flZoom
    );
    g_bDirty = true;
    return;
  }

  const c = g_renderer.ScreenToCell(flX, flY);
  const nW = GetMapW();
  const nH = GetMapH();
  if (c.nX >= 0 && c.nX < nW && c.nY >= 0 && c.nY < nH) {
    if (g_nHoverX !== c.nX || g_nHoverY !== c.nY) {
      g_nHoverX = c.nX;
      g_nHoverY = c.nY;
      UpdateStatus();
    }
    g_bDirty = true;
  } else {
    if (g_nHoverX !== -1) {
      g_nHoverX = -1; g_nHoverY = -1;
      g_bDirty = true;
      UpdateStatus();
    }
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 2 && g_bIsDragging) {
    g_bIsDragging = false;
    viewport.style.cursor = 'crosshair';
  }
});

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!HasMap() || !e.ctrlKey) return;
  let flFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  if (e.shiftKey) flFactor = e.deltaY < 0 ? 1.5 : 1 / 1.5;

  const rect = viewport.getBoundingClientRect();
  const flSx = e.clientX - rect.left;
  const flSy = e.clientY - rect.top;

  const wBefore = g_renderer.ScreenToWorld(flSx, flSy);

  let flNewZoom = g_renderer.m_flZoom * flFactor;
  flNewZoom = Math.max(0.05, Math.min(128, flNewZoom));

  const nVW = viewport.clientWidth;
  const nVH = viewport.clientHeight;
  const flNewCamX = wBefore.flX - (flSx - nVW / 2) / flNewZoom;
  const flNewCamY = wBefore.flY + (flSy - nVH / 2) / flNewZoom;

  g_renderer.SetCamera(flNewCamX, flNewCamY, flNewZoom);
  g_bDirty = true;
  UpdateStatus();
}, { passive: false });

viewport.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.ctrlKey && e.key === 'g') { e.preventDefault(); ShowGoTo(); return; }
  if (e.key === 'Home') { CenterMap(); return; }
  if (e.key === '0') { FitToView(); return; }
});

webMapIn.addEventListener('change', async (e) => {
  const fileList = e.target.files;
  if (!fileList || fileList.length === 0) return;
  await OpenWebMap(fileList);
  webMapIn.value = '';
});

function EnableMenus(bEnabled) {
  document.querySelector('[data-action="goTo"]').disabled = !bEnabled;
  document.querySelector('[data-action="centerMap"]').disabled = !bEnabled;
  document.querySelector('[data-action="fitView"]').disabled = !bEnabled;
}

document.querySelectorAll('.menu-item').forEach(item => {
  const label = item.querySelector('.menu-label');
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    if (g_openMenu === item) { CloseMenus(); } else { CloseMenus(); item.classList.add('open'); g_openMenu = item; }
  });
  label.addEventListener('mouseenter', () => {
    if (g_openMenu && g_openMenu !== item) { CloseMenus(); item.classList.add('open'); g_openMenu = item; }
  });
});
document.addEventListener('click', () => CloseMenus());
function CloseMenus() { document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('open')); g_openMenu = null; }

document.querySelector('[data-action="openWebMap"]').addEventListener('click', () => { CloseMenus(); webMapIn.click(); });

function _SyncToggle(szAction, szCheckboxId, fnGet, fnSet, fnApply) {
  document.querySelector(`[data-action="${szAction}"]`).addEventListener('click', (e) => {
    fnSet(!fnGet());
    e.target.classList.toggle('checked');
    document.getElementById(szCheckboxId).checked = fnGet();
    fnApply(fnGet());
    g_bDirty = true;
  });
  document.getElementById(szCheckboxId).addEventListener('change', (e) => {
    fnSet(e.target.checked);
    fnApply(fnGet());
    g_bDirty = true;
  });
}

_SyncToggle('toggleAccess', 'cAccess',
  () => g_bShowAccessGrid, (v) => g_bShowAccessGrid = v,
  (v) => g_renderer.SetAccessGridVisible(v));
_SyncToggle('togglePortals', 'cPortals',
  () => g_bShowPortals, (v) => g_bShowPortals = v,
  (v) => g_renderer.SetPortalsVisible(v));
_SyncToggle('toggleEffects', 'cEffects',
  () => g_bShowEffects, (v) => g_bShowEffects = v,
  (v) => g_renderer.SetEffectsVisible(v));
_SyncToggle('toggleSounds', 'cSounds',
  () => g_bShowSounds, (v) => g_bShowSounds = v,
  (v) => g_renderer.SetSoundsVisible(v));
_SyncToggle('toggleCovers', 'cCovers',
  () => g_bShowCovers, (v) => g_bShowCovers = v,
  (v) => g_renderer.SetCoversVisible(v));
_SyncToggle('toggleScenes', 'cScenes',
  () => g_bShowScenes, (v) => g_bShowScenes = v,
  (v) => g_renderer.SetScenesVisible(v));

document.querySelector('[data-action="goTo"]').addEventListener('click', () => { CloseMenus(); ShowGoTo(); });
document.querySelector('[data-action="centerMap"]').addEventListener('click', () => { CloseMenus(); CenterMap(); });
document.querySelector('[data-action="fitView"]').addEventListener('click', () => { CloseMenus(); FitToView(); });
document.querySelector('[data-action="about"]').addEventListener('click', () => { CloseMenus(); document.getElementById('dlgAbout').showModal(); });

function ShowGoTo() {
  if (!HasMap()) return;
  document.getElementById('dMapSize').textContent = `Map size: ${GetMapW()} x ${GetMapH()}`;
  document.getElementById('dlgGoTo').showModal();
}
document.getElementById('dGo').addEventListener('click', () => {
  GoToCell(parseInt(document.getElementById('dGX').value) || 0, parseInt(document.getElementById('dGY').value) || 0);
  document.getElementById('dlgGoTo').close();
});
document.getElementById('dCenter').addEventListener('click', () => { CenterMap(); document.getElementById('dlgGoTo').close(); });
document.getElementById('dCancel').addEventListener('click', () => { document.getElementById('dlgGoTo').close(); });
document.getElementById('dAboutOk').addEventListener('click', () => { document.getElementById('dlgAbout').close(); });

function UpdateStatus() {
  document.getElementById('sHover').textContent = `Hover: (${g_nHoverX}, ${g_nHoverY})`;
  document.getElementById('sZoom').textContent = `Zoom: ${g_renderer.m_flZoom.toFixed(1)}`;
  document.getElementById('sMode').textContent = 'MAP';
  document.getElementById('sFps').textContent = `FPS: ${Math.round(g_flFPS)}`;
}

function RenderWebMapLabels(nVW, nVH) {
  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, nVW, nVH);
  if (!g_pWebMap) return;
  const m = g_pWebMap.m_manifest;
  const coord = m.coord;
  const nBgW = g_renderer.m_nBgW;
  const nBgH = g_renderer.m_nBgH;

  if (g_bShowPortals && m.portals) {
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = '#00FFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const portal of m.portals) {
      const nWx = 32 * (portal.x - portal.y) + coord.originX;
      const nWy = 16 * (portal.x + portal.y) + coord.originY;
      const flThreeX = (nWx - coord.bgWorldX) - nBgW / 2;
      const flThreeY = nBgH / 2 - (nWy - coord.bgWorldY);
      const s = g_renderer.WorldToScreen(flThreeX, flThreeY);
      if (s.flX >= -50 && s.flX <= nVW + 50 && s.flY >= -50 && s.flY <= nVH + 50) {
        ctx.fillText(String(portal.id), s.flX, s.flY - 20 * g_renderer.m_flZoom);
      }
    }
  }

  if (g_bShowEffects && m.effects) {
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#FFFF00';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const effect of m.effects) {
      const flThreeX = (effect.wx - coord.bgWorldX) - nBgW / 2;
      const flThreeY = nBgH / 2 - (effect.wy - coord.bgWorldY);
      const s = g_renderer.WorldToScreen(flThreeX, flThreeY);
      if (s.flX >= -50 && s.flX <= nVW + 50 && s.flY >= -50 && s.flY <= nVH + 50) {
        ctx.fillText(effect.name, s.flX + 8 * g_renderer.m_flZoom, s.flY);
      }
    }
  }

  if (g_bShowSounds && m.sounds) {
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#64FF64';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const sound of m.sounds) {
      const flThreeX = (sound.wx - coord.bgWorldX) - nBgW / 2;
      const flThreeY = nBgH / 2 - (sound.wy - coord.bgWorldY);
      const s = g_renderer.WorldToScreen(flThreeX, flThreeY);
      if (s.flX >= -50 && s.flX <= nVW + 50 && s.flY >= -50 && s.flY <= nVH + 50) {
        ctx.fillText(sound.file, s.flX + 8 * g_renderer.m_flZoom, s.flY);
      }
    }
  }

  if (g_nHoverX < 0 || g_nHoverY < 0) return;

  const nWx = 32 * (g_nHoverX - g_nHoverY) + coord.originX;
  const nWy = 16 * (g_nHoverX + g_nHoverY) + coord.originY;

  const flToThreeX = (wx) => (wx - coord.bgWorldX) - nBgW / 2;
  const flToThreeY = (wy) => nBgH / 2 - (wy - coord.bgWorldY);

  const sTop = g_renderer.WorldToScreen(flToThreeX(nWx), flToThreeY(nWy));
  const sRight = g_renderer.WorldToScreen(flToThreeX(nWx + 32), flToThreeY(nWy + 16));
  const sBottom = g_renderer.WorldToScreen(flToThreeX(nWx), flToThreeY(nWy + 32));
  const sLeft = g_renderer.WorldToScreen(flToThreeX(nWx - 32), flToThreeY(nWy + 16));

  const bBlocked = _IsBlocked(g_nHoverX, g_nHoverY);

  ctx.beginPath();
  ctx.moveTo(sTop.flX, sTop.flY);
  ctx.lineTo(sRight.flX, sRight.flY);
  ctx.lineTo(sBottom.flX, sBottom.flY);
  ctx.lineTo(sLeft.flX, sLeft.flY);
  ctx.closePath();
  ctx.fillStyle = bBlocked ? 'rgba(255,60,60,0.25)' : 'rgba(255,255,255,0.15)';
  ctx.fill();
  ctx.strokeStyle = bBlocked ? '#FF4444' : '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const nTipX = g_flMouseX + 14;
  const nTipY = g_flMouseY - 10;
  const szLine1 = `Cell: (${g_nHoverX}, ${g_nHoverY})`;
  const szLine2 = bBlocked ? 'Blocked' : 'Walkable';
  ctx.font = '11px Consolas, monospace';
  const nTextW = Math.max(ctx.measureText(szLine1).width, ctx.measureText(szLine2).width);
  const nPad = 5;
  const nBoxW = nTextW + nPad * 2;
  const nBoxH = 32;

  let nDrawX = nTipX;
  let nDrawY = nTipY;
  if (nDrawX + nBoxW > nVW) nDrawX = g_flMouseX - nBoxW - 8;
  if (nDrawY + nBoxH > nVH) nDrawY = g_flMouseY - nBoxH - 8;
  if (nDrawY < 0) nDrawY = 4;

  ctx.fillStyle = 'rgba(20,20,20,0.88)';
  ctx.strokeStyle = 'rgba(110,110,128,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(nDrawX, nDrawY, nBoxW, nBoxH, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(szLine1, nDrawX + nPad, nDrawY + 3);
  ctx.fillStyle = bBlocked ? '#FF6666' : '#88FF88';
  ctx.fillText(szLine2, nDrawX + nPad, nDrawY + 17);
}

function OnFrame(flTime) {
  if (g_flLastTime > 0) {
    g_flFpsAccum += (flTime - g_flLastTime);
    g_nFrames++;
    if (g_flFpsAccum >= 500) {
      g_flFPS = (g_nFrames / g_flFpsAccum) * 1000;
      g_nFrames = 0;
      g_flFpsAccum = 0;
      UpdateStatus();
    }
  }
  g_flLastTime = flTime;

  if (g_renderer.m_bWebMapMode) {
    g_renderer.AnimateWebMap(flTime);
    if (g_renderer.m_bDirty) g_bDirty = true;
  }

  if (g_bDirty && HasMap()) {
    g_renderer.MarkDirty();
    g_renderer.Render();
    const nVW = viewport.clientWidth;
    const nVH = viewport.clientHeight;
    overlayCanvas.width = nVW;
    overlayCanvas.height = nVH;
    RenderWebMapLabels(nVW, nVH);
    g_bDirty = false;
  }

  requestAnimationFrame(OnFrame);
}

window.addEventListener('resize', () => {
  g_renderer.Resize();
  g_bDirty = true;
});

document.querySelectorAll('.imgui-title').forEach(t => {
  t.addEventListener('click', () => t.parentElement.classList.toggle('collapsed'));
});

document.querySelectorAll('.obj-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.obj-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.obj-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.objtab).classList.add('active');
  });
});

requestAnimationFrame(OnFrame);

async function DiscoverMaps() {
  const params = new URLSearchParams(window.location.search);
  const szDirectMap = params.get('map');

  if (szDirectMap) {
    const bOk = await OpenWebMapFromUrl('toWeb/' + szDirectMap);
    if (bOk) return;
  }

  try {
    const resp = await fetch('toWeb/maps.json');
    if (!resp.ok) return;

    const vecMaps = await resp.json();
    if (!Array.isArray(vecMaps) || vecMaps.length === 0) return;

    const elList = document.getElementById('mapList');
    const elItems = document.getElementById('mapListItems');

    elItems.innerHTML = '';
    for (const szName of vecMaps) {
      const btn = document.createElement('button');
      btn.className = 'map-item';
      btn.textContent = szName;
      btn.addEventListener('click', async () => {
        btn.classList.add('loading');
        btn.textContent = szName + ' ...';
        await OpenWebMapFromUrl('toWeb/' + szName);
        btn.classList.remove('loading');
        btn.textContent = szName;
      });
      elItems.appendChild(btn);
    }

    elList.style.display = '';
  } catch (e) {}
}

DiscoverMaps();
