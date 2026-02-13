import CMapRenderer from './CMapRenderer.js';
import CWebMapLoader from './CWebMapLoader.js';

const viewport = document.getElementById('viewport');
const overlayCanvas = document.getElementById('overlayCanvas');
const webMapIn = document.getElementById('webMapIn');
const zipMapIn = document.getElementById('zipMapIn');

let g_pWebMap = null;
let g_renderer = new CMapRenderer(viewport);

let g_nHoverX = -1, g_nHoverY = -1;
let g_bShowAccessGrid = true, g_bShowPortals = true, g_bShowEffects = true, g_bShowSounds = true;
let g_bShowCovers = true, g_bShowScenes = true, g_bShowNpcs = true, g_bShowMobs = true;
let g_szPortalColor = '#00FFFF', g_szEffectColor = '#FFFF00', g_szSoundColor = '#64FF64';
let g_szNpcColor = '#FF8800', g_szMobColor = '#FF4444';
let g_bDirty = true;

let g_pDmap = null;
let g_flMouseX = 0, g_flMouseY = 0;

let g_bIsDragging = false;
let g_flDragStartX = 0, g_flDragStartY = 0;

let g_bTouchDragging = false;
let g_nTouchCount = 0;
let g_flTouchStartX = 0, g_flTouchStartY = 0;
let g_flPinchDist = 0, g_flPinchZoom = 0;
let g_flPinchCX = 0, g_flPinchCY = 0;

let g_flLastTime = 0, g_nFrames = 0, g_flFpsAccum = 0, g_flFPS = 0;

let g_openMenu = null;

function HasMap() { return g_renderer.m_bWebMapMode; }
function GetMapW() { return g_renderer.m_nMapW; }
function GetMapH() { return g_renderer.m_nMapH; }

function ShowLoading() {
  document.getElementById('loadingOverlay').style.display = '';
  document.getElementById('loadingBarFill').style.width = '0%';
  document.getElementById('loadingStatus').textContent = 'Preparing...';
}

function UpdateLoading(nCurrent, nTotal, szStatus) {
  document.getElementById('loadingStatus').textContent = szStatus;
  if (nTotal > 0) {
    const flPct = Math.min(100, (nCurrent / nTotal) * 100);
    document.getElementById('loadingBarFill').style.width = flPct + '%';
  }
}

function HideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

async function OpenWebMap(fileList) {
  ShowLoading();
  const loader = new CWebMapLoader();
  if (!(await loader.Load(fileList, UpdateLoading))) { HideLoading(); return; }
  _ActivateMap(loader);
  HideLoading();
}

async function OpenWebMapFromUrl(szBaseUrl) {
  ShowLoading();
  const loader = new CWebMapLoader();
  if (!(await loader.LoadFromUrl(szBaseUrl, UpdateLoading))) { HideLoading(); return false; }
  _ActivateMap(loader);
  HideLoading();
  return true;
}

async function OpenZipMapFile(file) {
  ShowLoading();
  const loader = new CWebMapLoader();
  const blob = await file.arrayBuffer().then(buf => new Blob([buf]));
  if (!(await loader.LoadFromZipBlob(blob, UpdateLoading))) { HideLoading(); return false; }
  _ActivateMap(loader);
  HideLoading();
  return true;
}

async function OpenZipMapFromUrl(szUrl) {
  ShowLoading();
  const loader = new CWebMapLoader();
  if (!(await loader.LoadFromZipUrl(szUrl, UpdateLoading))) { HideLoading(); return false; }
  _ActivateMap(loader);
  HideLoading();
  return true;
}

function _IsBlocked(nX, nY) {
  if (!g_pDmap) return false;
  return g_pDmap.GetBlocked(nX, nY) !== 0;
}

function _ActivateMap(loader) {
  g_pWebMap = loader;
  g_nHoverX = -1;
  g_nHoverY = -1;
  g_pDmap = loader.m_pDmap || null;

  const m = loader.m_manifest;

  g_renderer.BuildWebMap(m, loader.m_atlasTextures, loader.m_spriteTextures, loader.m_vecNpcs, loader.m_vecMobSpawns);

  if (g_pDmap) {
    g_renderer.BuildAccessOverlayFromDmap(g_pDmap, m);
  }
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
  const nNpcs = g_pWebMap ? g_pWebMap.m_vecNpcs.length : 0;
  const nMobSpawns = g_pWebMap ? g_pWebMap.m_vecMobSpawns.length : 0;
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
    `Scenes: ${nScenes}<br>` +
    `NPCs: ${nNpcs}<br>` +
    `Mob Spawns: ${nMobSpawns}`;

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

  const vecNpcs = g_pWebMap ? g_pWebMap.m_vecNpcs : [];
  _BuildObjList('objNpcs', vecNpcs, (npc, i) => ({
    szInfo: npc.szName || `NPC ${npc.nNpcId}`, szPos: `(${npc.nX}, ${npc.nY})`,
    fnGo: () => GoToCell(npc.nX, npc.nY)
  }));

  const vecMobSpawns = g_pWebMap ? g_pWebMap.m_vecMobSpawns : [];
  _BuildObjList('objMobs', vecMobSpawns, (spawn, i) => {
    const nCX = spawn.nBoundX + Math.floor(spawn.nBoundCX / 2);
    const nCY = spawn.nBoundY + Math.floor(spawn.nBoundCY / 2);
    return {
      szInfo: spawn.szName || `Mob ${spawn.nNpcType}`, szPos: `(${nCX}, ${nCY})`,
      fnGo: () => GoToCell(nCX, nCY)
    };
  });
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

const g_bIsTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!HasMap()) return;
  if (!e.ctrlKey && !g_bIsTouchDevice) return;
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

function _TouchDist(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

viewport.addEventListener('touchstart', (e) => {
  if (!HasMap()) return;
  e.preventDefault();
  g_nTouchCount = e.touches.length;

  if (g_nTouchCount === 1) {
    g_bTouchDragging = true;
    g_flTouchStartX = e.touches[0].clientX;
    g_flTouchStartY = e.touches[0].clientY;
  } else if (g_nTouchCount === 2) {
    g_bTouchDragging = false;
    g_flPinchDist = _TouchDist(e.touches[0], e.touches[1]);
    g_flPinchZoom = g_renderer.m_flZoom;
    g_flPinchCX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    g_flPinchCY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  }
}, { passive: false });

viewport.addEventListener('touchmove', (e) => {
  if (!HasMap()) return;
  e.preventDefault();

  if (e.touches.length === 1 && g_bTouchDragging) {
    const flDx = (e.touches[0].clientX - g_flTouchStartX) / g_renderer.m_flZoom;
    const flDy = (e.touches[0].clientY - g_flTouchStartY) / g_renderer.m_flZoom;
    g_flTouchStartX = e.touches[0].clientX;
    g_flTouchStartY = e.touches[0].clientY;
    g_renderer.SetCamera(
      g_renderer.m_flCamX - flDx,
      g_renderer.m_flCamY + flDy,
      g_renderer.m_flZoom
    );
    g_bDirty = true;
  } else if (e.touches.length === 2) {
    const flNewDist = _TouchDist(e.touches[0], e.touches[1]);
    if (g_flPinchDist > 0) {
      const flScale = flNewDist / g_flPinchDist;
      let flNewZoom = g_flPinchZoom * flScale;
      flNewZoom = Math.max(0.05, Math.min(128, flNewZoom));

      const rect = viewport.getBoundingClientRect();
      const flSx = g_flPinchCX - rect.left;
      const flSy = g_flPinchCY - rect.top;
      const wBefore = g_renderer.ScreenToWorld(flSx, flSy);

      const nVW = viewport.clientWidth;
      const nVH = viewport.clientHeight;
      const flNewCamX = wBefore.flX - (flSx - nVW / 2) / flNewZoom;
      const flNewCamY = wBefore.flY + (flSy - nVH / 2) / flNewZoom;

      g_renderer.SetCamera(flNewCamX, flNewCamY, flNewZoom);
      g_bDirty = true;
      UpdateStatus();
    }
  }
}, { passive: false });

viewport.addEventListener('touchend', (e) => {
  if (e.touches.length === 0) {
    g_bTouchDragging = false;
    g_nTouchCount = 0;
  } else if (e.touches.length === 1) {
    g_bTouchDragging = true;
    g_flTouchStartX = e.touches[0].clientX;
    g_flTouchStartY = e.touches[0].clientY;
    g_nTouchCount = 1;
  }
});

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

zipMapIn.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await OpenZipMapFile(file);
  zipMapIn.value = '';
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
document.querySelector('[data-action="openZipMap"]').addEventListener('click', () => { CloseMenus(); zipMapIn.click(); });

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
_SyncToggle('toggleNpcs', 'cNpcs',
  () => g_bShowNpcs, (v) => g_bShowNpcs = v,
  (v) => g_renderer.SetNpcsVisible(v));
_SyncToggle('toggleMobs', 'cMobs',
  () => g_bShowMobs, (v) => g_bShowMobs = v,
  (v) => g_renderer.SetMobsVisible(v));

function _HexToRgb01(szHex) {
  const n = parseInt(szHex.substring(1), 16);
  return { r: ((n >> 16) & 0xFF) / 255, g: ((n >> 8) & 0xFF) / 255, b: (n & 0xFF) / 255 };
}

document.getElementById('clrAccess').addEventListener('input', (e) => {
  const c = _HexToRgb01(e.target.value);
  g_renderer.SetAccessColor(c.r, c.g, c.b);
  g_bDirty = true;
});
document.getElementById('clrPortals').addEventListener('input', (e) => {
  g_szPortalColor = e.target.value;
  g_renderer.SetPortalColor(parseInt(e.target.value.substring(1), 16));
  g_bDirty = true;
});
document.getElementById('clrEffects').addEventListener('input', (e) => {
  g_szEffectColor = e.target.value;
  g_renderer.SetEffectColor(parseInt(e.target.value.substring(1), 16));
  g_bDirty = true;
});
document.getElementById('clrSounds').addEventListener('input', (e) => {
  g_szSoundColor = e.target.value;
  g_renderer.SetSoundColor(parseInt(e.target.value.substring(1), 16));
  g_bDirty = true;
});
document.getElementById('clrNpcs').addEventListener('input', (e) => {
  g_szNpcColor = e.target.value;
  g_renderer.SetNpcColor(parseInt(e.target.value.substring(1), 16));
  g_bDirty = true;
});
document.getElementById('clrMobs').addEventListener('input', (e) => {
  g_szMobColor = e.target.value;
  g_renderer.SetMobColor(parseInt(e.target.value.substring(1), 16));
  g_bDirty = true;
});

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
    ctx.fillStyle = g_szPortalColor;
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
    ctx.fillStyle = g_szEffectColor;
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
    ctx.fillStyle = g_szSoundColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const sound of m.sounds) {
      const flThreeX = (sound.wx - coord.bgWorldX) - nBgW / 2;
      const flThreeY = nBgH / 2 - (sound.wy - coord.bgWorldY);
      const s = g_renderer.WorldToScreen(flThreeX, flThreeY);
      if (s.flX >= -50 && s.flX <= nVW + 50 && s.flY >= -50 && s.flY <= nVH + 50) {
        const szName = sound.file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
        const szLabel = sound.range > 0 ? `${szName} (R:${sound.range})` : szName;
        ctx.fillText(szLabel, s.flX + 8 * g_renderer.m_flZoom, s.flY);
      }
    }
  }

  if (g_bShowNpcs && g_pWebMap && g_pWebMap.m_vecNpcs.length > 0) {
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = g_szNpcColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const npc of g_pWebMap.m_vecNpcs) {
      const nWx = 32 * (npc.nX - npc.nY) + coord.originX;
      const nWy = 16 * (npc.nX + npc.nY) + coord.originY;
      const flThreeX = (nWx - coord.bgWorldX) - nBgW / 2;
      const flThreeY = nBgH / 2 - (nWy - coord.bgWorldY);
      const s = g_renderer.WorldToScreen(flThreeX, flThreeY);
      if (s.flX >= -80 && s.flX <= nVW + 80 && s.flY >= -20 && s.flY <= nVH + 20) {
        const szLabel = npc.szName || `NPC ${npc.nNpcId}`;
        ctx.fillText(szLabel, s.flX + 8 * g_renderer.m_flZoom, s.flY);
      }
    }
  }

  if (g_bShowMobs && g_pWebMap && g_pWebMap.m_vecMobSpawns.length > 0) {
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = g_szMobColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const spawn of g_pWebMap.m_vecMobSpawns) {
      const nCX = spawn.nBoundX + Math.floor(spawn.nBoundCX / 2);
      const nCY = spawn.nBoundY + Math.floor(spawn.nBoundCY / 2);
      const nWx = 32 * (nCX - nCY) + coord.originX;
      const nWy = 16 * (nCX + nCY) + coord.originY;
      const flThreeX = (nWx - coord.bgWorldX) - nBgW / 2;
      const flThreeY = nBgH / 2 - (nWy - coord.bgWorldY);
      const s = g_renderer.WorldToScreen(flThreeX, flThreeY);
      if (s.flX >= -80 && s.flX <= nVW + 80 && s.flY >= -20 && s.flY <= nVH + 20) {
        const szLabel = spawn.szName || `Mob ${spawn.nNpcType}`;
        ctx.fillText(szLabel, s.flX + 12, s.flY);
      }
    }
  }

  if (g_nHoverX < 0 || g_nHoverY < 0) return;

  const nWx = 32 * (g_nHoverX - g_nHoverY) + coord.originX;
  const nWy = 16 * (g_nHoverX + g_nHoverY) + coord.originY;

  const flToThreeX = (wx) => (wx - coord.bgWorldX) - nBgW / 2;
  const flToThreeY = (wy) => nBgH / 2 - (wy - coord.bgWorldY);

  const sTop = g_renderer.WorldToScreen(flToThreeX(nWx), flToThreeY(nWy - 16));
  const sRight = g_renderer.WorldToScreen(flToThreeX(nWx + 32), flToThreeY(nWy));
  const sBottom = g_renderer.WorldToScreen(flToThreeX(nWx), flToThreeY(nWy + 16));
  const sLeft = g_renderer.WorldToScreen(flToThreeX(nWx - 32), flToThreeY(nWy));

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

const elPanel = document.getElementById('panel');
const elBackdrop = document.getElementById('panelBackdrop');
const elHamburger = document.getElementById('btnHamburger');

function TogglePanel() {
  elPanel.classList.toggle('open');
  elBackdrop.classList.toggle('open');
}

elHamburger.addEventListener('click', (e) => {
  e.stopPropagation();
  TogglePanel();
});

elBackdrop.addEventListener('click', () => {
  elPanel.classList.remove('open');
  elBackdrop.classList.remove('open');
});

window.addEventListener('resize', () => {
  g_renderer.Resize();
  g_bDirty = true;
  if (window.innerWidth > 768) {
    elPanel.classList.remove('open');
    elBackdrop.classList.remove('open');
  }
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

async function _TryLoadMap(szName) {
  const bFolder = await OpenWebMapFromUrl('toWeb/' + szName);
  if (bFolder) return true;
  const zipResp = await fetch('toWeb/' + szName + '.zip', { method: 'HEAD' }).catch(() => null);
  if (zipResp && zipResp.ok) {
    return await OpenZipMapFromUrl('toWeb/' + szName + '.zip');
  }
  console.error('[_TryLoadMap] map not found:', szName);
  return false;
}

async function DiscoverMaps() {
  const params = new URLSearchParams(window.location.search);
  const szDirectMap = params.get('map');

  if (szDirectMap) {
    const bOk = await _TryLoadMap(szDirectMap);
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
        await _TryLoadMap(szName);
        btn.classList.remove('loading');
        btn.textContent = szName;
      });
      elItems.appendChild(btn);
    }

    elList.style.display = '';

    const elDropdown = document.getElementById('mapsDropdown');
    const elEmpty = document.getElementById('mapsDropdownEmpty');
    elEmpty.style.display = 'none';
    for (const szName of vecMaps) {
      const btn = document.createElement('button');
      btn.textContent = szName;
      btn.addEventListener('click', async () => {
        CloseMenus();
        await _TryLoadMap(szName);
      });
      elDropdown.appendChild(btn);
    }
  } catch (e) {}
}

DiscoverMaps();
