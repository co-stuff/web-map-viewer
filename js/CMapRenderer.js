import * as THREE from 'three';
import { g_surfaceColors, g_blockedColorRGB, g_bgColorRGB } from './CSurfaceColors.js';

const VERT_SHADER = `
varying vec2 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG_SHADER = `
uniform sampler2D uMap;
uniform vec2 uSize;
uniform bool uGrid;
uniform bool uIso;
varying vec2 vWorldPos;
void main() {
  float cx, cy;
  if (uIso) {
    cx = vWorldPos.x * 0.5 - vWorldPos.y + uSize.x * 0.5;
    cy = -vWorldPos.x * 0.5 - vWorldPos.y + uSize.y * 0.5;
  } else {
    cx = vWorldPos.x + uSize.x * 0.5;
    cy = -vWorldPos.y + uSize.y * 0.5;
  }
  if (cx < 0.0 || cx >= uSize.x || cy < 0.0 || cy >= uSize.y) {
    gl_FragColor = vec4(0.118, 0.118, 0.118, 1.0);
    return;
  }
  vec2 uv = vec2(cx / uSize.x, 1.0 - cy / uSize.y);
  vec4 c = texture2D(uMap, uv);
  if (uGrid) {
    vec2 f = vec2(fract(cx), fract(cy));
    float t = 0.08;
    if (f.x < t || f.x > (1.0 - t) || f.y < t || f.y > (1.0 - t)) {
      c.rgb *= 0.5;
    }
  }
  gl_FragColor = c;
}`;

const PORTAL_VS = `
varying vec2 vLocalPos;
void main() {
  vLocalPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const PORTAL_FS = `
uniform sampler2D uPortalTex;
uniform float uTime;
varying vec2 vLocalPos;
void main() {
  float angle = uTime * 0.0075;
  float rx = vLocalPos.x - 2.0 * vLocalPos.y;
  float ry = -vLocalPos.x - 2.0 * vLocalPos.y;
  float c = cos(angle);
  float s = sin(angle);
  float tx = rx * c + ry * s;
  float ty = -rx * s + ry * c;
  float u = (tx + 128.0) / 256.0;
  float v = 1.0 - (ty + 128.0) / 256.0;
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) discard;
  vec4 col = texture2D(uPortalTex, vec2(u, v));
  float portalAlpha = 0.5 + 0.5 * sin(angle * 0.5);
  col.a *= portalAlpha;
  if (col.a < 0.01) discard;
  gl_FragColor = col;
}`;

const ACCESS_OVERLAY_VS = `
varying vec2 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const ACCESS_OVERLAY_FS = `
uniform sampler2D uAccessTex;
uniform vec2 uMapSize;
uniform vec2 uBgSize;
uniform vec2 uOrigin;
uniform vec2 uBgWorldPos;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vWorldPos;
void main() {
  float bgX = vWorldPos.x + uBgSize.x * 0.5;
  float bgY = uBgSize.y * 0.5 - vWorldPos.y;

  float gwx = bgX + uBgWorldPos.x;
  float gwy = bgY + uBgWorldPos.y;

  float dwx = gwx - uOrigin.x;
  float dwy = gwy - uOrigin.y;

  float cx = floor(dwx / 64.0 + dwy / 32.0 + 0.5);
  float cy = floor(dwy / 32.0 - dwx / 64.0 + 0.5);

  if (cx < 0.0 || cx >= uMapSize.x || cy < 0.0 || cy >= uMapSize.y) {
    discard;
  }

  vec2 uv = vec2((cx + 0.5) / uMapSize.x, (cy + 0.5) / uMapSize.y);
  float blocked = texture2D(uAccessTex, uv).r;

  if (blocked > 0.5) {
    gl_FragColor = vec4(uColor, uAlpha);
  } else {
    discard;
  }
}`;

export default class CMapRenderer {
  constructor(container) {
    this.m_container = container;
    this.m_nMapW = 0;
    this.m_nMapH = 0;
    this.m_bIsIso = false;
    this.m_bShowGrid = true;
    this.m_bDirty = true;

    this.m_flCamX = 0;
    this.m_flCamY = 0;
    this.m_flZoom = 1.0;

    this.m_mapTexData = null;
    this.m_mapTexture = null;
    this.m_mapMesh = null;
    this.m_uniforms = null;

    this.m_bWebMapMode = false;
    this.m_manifest = null;
    this.m_nBgW = 0;
    this.m_nBgH = 0;
    this.m_bgGroup = null;
    this.m_coverGroup = null;
    this.m_sceneGroup = null;
    this.m_portalGroup = null;
    this.m_effectGroup = null;
    this.m_soundGroup = null;
    this.m_npcGroup = null;
    this.m_mobGroup = null;
    this.m_overlayMesh = null;
    this.m_accessTexture = null;
    this.m_overlayUniforms = null;
    this.m_portalMaterial = null;
    this.m_bShowAccessGrid = true;
    this.m_animations = [];

    const nW = container.clientWidth;
    const nH = container.clientHeight;

    this.m_renderer = new THREE.WebGLRenderer({ antialias: false });
    this.m_renderer.setSize(nW, nH);
    this.m_renderer.setPixelRatio(1);
    this.m_renderer.setClearColor(0x1E1E1E);
    container.insertBefore(this.m_renderer.domElement, container.firstChild);

    this.m_camera = new THREE.OrthographicCamera(-nW / 2, nW / 2, nH / 2, -nH / 2, 0.1, 100);
    this.m_camera.position.set(0, 0, 5);

    this.m_scene = new THREE.Scene();
    this.m_scene.background = new THREE.Color(0x1E1E1E);
  }

  BuildMapTexture(pDmap, bShowBlocked) {
    const nW = pDmap.GetWidth();
    const nH = pDmap.GetHeight();
    this.m_nMapW = nW;
    this.m_nMapH = nH;

    this.m_mapTexData = new Uint8Array(nW * nH * 4);
    this.UpdateMapTexture(pDmap, bShowBlocked);

    this.m_mapTexture = new THREE.DataTexture(this.m_mapTexData, nW, nH, THREE.RGBAFormat);
    this.m_mapTexture.minFilter = THREE.NearestFilter;
    this.m_mapTexture.magFilter = THREE.NearestFilter;
    this.m_mapTexture.needsUpdate = true;

    if (this.m_mapMesh) {
      this.m_scene.remove(this.m_mapMesh);
      this.m_mapMesh.geometry.dispose();
      this.m_mapMesh.material.dispose();
    }

    this.m_uniforms = {
      uMap: { value: this.m_mapTexture },
      uSize: { value: new THREE.Vector2(nW, nH) },
      uGrid: { value: true },
      uIso: { value: this.m_bIsIso }
    };

    const nGeoW = nW + nH + 4;
    const nGeoH = Math.max(nH, (nW + nH) / 2) + 4;
    const geo = new THREE.PlaneGeometry(nGeoW, nGeoH);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.m_uniforms,
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER
    });
    this.m_mapMesh = new THREE.Mesh(geo, mat);
    this.m_scene.add(this.m_mapMesh);
    this.m_bDirty = true;
  }

  UpdateMapTexture(pDmap, bShowBlocked) {
    const nW = pDmap.GetWidth();
    const nH = pDmap.GetHeight();
    const d = this.m_mapTexData;
    const blocked = pDmap.m_blocked;
    const surface = pDmap.m_surface;

    for (let nY = 0; nY < nH; nY++) {
      const nSrcRow = nY * nW;
      const nDstRow = ((nH - 1) - nY) * nW;
      for (let nX = 0; nX < nW; nX++) {
        const nSrcIdx = nSrcRow + nX;
        const nDstIdx = (nDstRow + nX) * 4;
        let rgb;
        if (blocked[nSrcIdx]) {
          rgb = bShowBlocked ? g_blockedColorRGB : g_bgColorRGB;
        } else {
          rgb = g_surfaceColors[surface[nSrcIdx] % 10];
        }
        d[nDstIdx] = rgb[0];
        d[nDstIdx + 1] = rgb[1];
        d[nDstIdx + 2] = rgb[2];
        d[nDstIdx + 3] = 255;
      }
    }
  }

  RefreshMapTexture(pDmap, bShowBlocked) {
    if (!this.m_mapTexData) return;
    this.UpdateMapTexture(pDmap, bShowBlocked);
    this.m_mapTexture.needsUpdate = true;
    this.m_bDirty = true;
  }

  ClearScene() {
    while (this.m_scene.children.length > 0) {
      const child = this.m_scene.children[0];
      this.m_scene.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    }
    if (this.m_bgGroup) {
      this.m_bgGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.m_bgGroup = null;
    }
    if (this.m_coverGroup) {
      this.m_coverGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.m_coverGroup = null;
    }
    if (this.m_sceneGroup) {
      this.m_sceneGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.m_sceneGroup = null;
    }
    if (this.m_portalGroup) {
      this.m_portalGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material && obj.material !== this.m_portalMaterial) obj.material.dispose();
      });
      this.m_portalGroup = null;
    }
    if (this.m_portalMaterial) {
      this.m_portalMaterial.dispose();
      this.m_portalMaterial = null;
    }
    if (this.m_effectGroup) {
      this.m_effectGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.m_effectGroup = null;
    }
    if (this.m_soundGroup) {
      this.m_soundGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.m_soundGroup = null;
    }
    if (this.m_npcGroup) {
      this.m_npcGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.m_npcGroup = null;
    }
    if (this.m_mobGroup) {
      this.m_mobGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.m_mobGroup = null;
    }
    this.m_overlayMesh = null;
    this.m_overlayUniforms = null;
    this.m_mapMesh = null;
    this.m_uniforms = null;
    this.m_animations = [];
  }

  BuildWebMap(manifest, atlasTextures, spriteTextures, vecNpcs, vecMobSpawns) {
    this.ClearScene();
    this.m_bWebMapMode = true;
    this.m_manifest = manifest;
    this.m_nBgW = manifest.puzzle.bgW;
    this.m_nBgH = manifest.puzzle.bgH;
    this.m_nMapW = manifest.size.w;
    this.m_nMapH = manifest.size.h;

    this._BuildPuzzleTiles(manifest, atlasTextures);
    this._BuildAnimatedTiles(manifest, spriteTextures);
    this._BuildScenes(manifest, spriteTextures);
    this._BuildCovers(manifest, spriteTextures);
    this._BuildPortals(manifest, spriteTextures);
    this._BuildEffects(manifest);
    this._BuildSounds(manifest);
    this._BuildNpcs(vecNpcs || []);
    this._BuildMobs(vecMobSpawns || []);

    this.m_bDirty = true;
  }

  _BuildPuzzleTiles(manifest, atlasTextures) {
    this.m_bgGroup = new THREE.Group();
    this.m_bgGroup.renderOrder = 0;

    const grid = manifest.grid;
    const nTilePx = manifest.puzzle.tilePx;
    const nBgW = this.m_nBgW;
    const nBgH = this.m_nBgH;

    const atlasGroups = new Map();
    for (let nRow = 0; nRow < grid.length; nRow++) {
      for (let nCol = 0; nCol < grid[nRow].length; nCol++) {
        const cell = grid[nRow][nCol];
        if (!cell) continue;
        if (!atlasGroups.has(cell.a)) atlasGroups.set(cell.a, []);
        atlasGroups.get(cell.a).push({ nCol, nRow, nGx: cell.gx, nGy: cell.gy });
      }
    }

    for (const [nAtlasIdx, tiles] of atlasGroups) {
      const atlas = manifest.atlases[nAtlasIdx];
      if (!atlas || !atlasTextures[nAtlasIdx]) continue;
      const nAtlasSize = atlas.size;
      const flHalfPx = 0.5 / nAtlasSize;

      const tex = atlasTextures[nAtlasIdx];
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.needsUpdate = true;

      const positions = [];
      const uvs = [];
      const indices = [];
      let nVi = 0;

      for (const tile of tiles) {
        const flX0 = tile.nCol * nTilePx - nBgW / 2;
        const flY1 = nBgH / 2 - tile.nRow * nTilePx;
        const flX1 = flX0 + nTilePx;
        const flY0 = flY1 - nTilePx;

        positions.push(flX0, flY1, 0, flX1, flY1, 0, flX1, flY0, 0, flX0, flY0, 0);

        const flU0 = tile.nGx * nTilePx / nAtlasSize + flHalfPx;
        const flU1 = (tile.nGx + 1) * nTilePx / nAtlasSize - flHalfPx;
        const flV1 = 1 - tile.nGy * nTilePx / nAtlasSize - flHalfPx;
        const flV0 = 1 - (tile.nGy + 1) * nTilePx / nAtlasSize + flHalfPx;

        uvs.push(flU0, flV1, flU1, flV1, flU1, flV0, flU0, flV0);

        indices.push(nVi, nVi + 3, nVi + 1, nVi + 3, nVi + 2, nVi + 1);
        nVi += 4;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);

      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthTest: false
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 0;
      this.m_bgGroup.add(mesh);
    }

    this.m_scene.add(this.m_bgGroup);
  }

  _BuildAnimatedTiles(manifest, spriteTextures) {
    const animTiles = manifest.animatedTiles || [];
    if (animTiles.length === 0) return;

    const nTilePx = manifest.puzzle.tilePx;
    const nBgW = this.m_nBgW;
    const nBgH = this.m_nBgH;

    const spriteGroups = new Map();
    for (const at of animTiles) {
      if (!spriteGroups.has(at.sprite)) spriteGroups.set(at.sprite, []);
      spriteGroups.get(at.sprite).push(at);
    }

    for (const [szSprite, tiles] of spriteGroups) {
      const tex = spriteTextures.get(szSprite);
      if (!tex) continue;

      const nFrameCount = tiles[0].frames;
      const nInterval = tiles[0].interval;

      const clonedTex = tex.clone();
      clonedTex.needsUpdate = true;
      clonedTex.wrapS = THREE.RepeatWrapping;
      clonedTex.repeat.set(1 / nFrameCount, 1);
      clonedTex.offset.set(0, 0);

      const positions = [];
      const uvs = [];
      const indices = [];
      let nVi = 0;

      for (const at of tiles) {
        const flX0 = at.gx * nTilePx - nBgW / 2;
        const flY1 = nBgH / 2 - at.gy * nTilePx;
        const flX1 = flX0 + nTilePx;
        const flY0 = flY1 - nTilePx;

        positions.push(flX0, flY1, 0, flX1, flY1, 0, flX1, flY0, 0, flX0, flY0, 0);
        uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
        indices.push(nVi, nVi + 3, nVi + 1, nVi + 3, nVi + 2, nVi + 1);
        nVi += 4;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);

      const mat = new THREE.MeshBasicMaterial({
        map: clonedTex,
        transparent: true,
        depthTest: false
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      this.m_bgGroup.add(mesh);

      if (nFrameCount > 1 && nInterval > 0) {
        this.m_animations.push({
          texture: clonedTex,
          nFrameCount: nFrameCount,
          nInterval: nInterval,
          flLastFrameTime: 0,
          nCurrentFrame: 0
        });
      }
    }
  }

  _CellToBgPixel(nCx, nCy) {
    const m = this.m_manifest.coord;
    const nWorldX = 32 * (nCx - nCy) + m.originX;
    const nWorldY = 16 * (nCx + nCy) + m.originY;
    return {
      nX: nWorldX - m.bgWorldX,
      nY: nWorldY - m.bgWorldY
    };
  }

  _BuildCovers(manifest, spriteTextures) {
    const covers = manifest.covers || [];
    if (covers.length === 0) return;

    this.m_coverGroup = new THREE.Group();
    this.m_coverGroup.renderOrder = 3;

    for (const cover of covers) {
      const tex = spriteTextures.get(cover.sprite);
      if (!tex) continue;

      const bg = this._CellToBgPixel(cover.tileX, cover.tileY);
      const nBgX = bg.nX - cover.offX;
      const nBgY = bg.nY - cover.offY;

      const flThreeX = nBgX - this.m_nBgW / 2 + cover.fw / 2;
      const flThreeY = this.m_nBgH / 2 - nBgY - cover.fh / 2;

      let useTex = tex;
      const nFrameCount = cover.frames || 1;
      if (nFrameCount > 1) {
        useTex = tex.clone();
        useTex.needsUpdate = true;
        useTex.wrapS = THREE.RepeatWrapping;
        useTex.repeat.set(1 / nFrameCount, 1);
        useTex.offset.set(0, 0);

        if (cover.interval > 0) {
          this.m_animations.push({
            texture: useTex,
            nFrameCount: nFrameCount,
            nInterval: cover.interval,
            flLastFrameTime: 0,
            nCurrentFrame: 0
          });
        }
      }

      const geo = new THREE.PlaneGeometry(cover.fw, cover.fh);
      const mat = new THREE.MeshBasicMaterial({
        map: useTex,
        transparent: true,
        depthTest: false
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(flThreeX, flThreeY, 0);
      mesh.renderOrder = 3;
      this.m_coverGroup.add(mesh);
    }

    this.m_scene.add(this.m_coverGroup);
  }

  _BuildScenes(manifest, spriteTextures) {
    const scenes = manifest.scenes || [];
    if (scenes.length === 0) return;

    this.m_sceneGroup = new THREE.Group();
    this.m_sceneGroup.renderOrder = 2;

    for (const scene of scenes) {
      for (const part of scene.parts || []) {
        const tex = spriteTextures.get(part.sprite);
        if (!tex) continue;

        const bg = this._CellToBgPixel(
          scene.tileX + part.tileOffX,
          scene.tileY + part.tileOffY
        );
        const nBgX = bg.nX + part.pixOffX;
        const nBgY = bg.nY + part.pixOffY;

        const flThreeX = nBgX - this.m_nBgW / 2 + part.fw / 2;
        const flThreeY = this.m_nBgH / 2 - nBgY - part.fh / 2;

        let useTex = tex;
        const nFrameCount = part.frames || 1;
        if (nFrameCount > 1) {
          useTex = tex.clone();
          useTex.needsUpdate = true;
          useTex.wrapS = THREE.RepeatWrapping;
          useTex.repeat.set(1 / nFrameCount, 1);
          useTex.offset.set(0, 0);

          if (part.interval > 0) {
            this.m_animations.push({
              texture: useTex,
              nFrameCount: nFrameCount,
              nInterval: part.interval,
              flLastFrameTime: 0,
              nCurrentFrame: 0
            });
          }
        }

        const geo = new THREE.PlaneGeometry(part.fw, part.fh);
        const mat = new THREE.MeshBasicMaterial({
          map: useTex,
          transparent: true,
          depthTest: false
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(flThreeX, flThreeY, 0);
        mesh.renderOrder = 2;
        this.m_sceneGroup.add(mesh);
      }
    }

    this.m_scene.add(this.m_sceneGroup);
  }

  _BuildPortals(manifest, spriteTextures) {
    const portals = manifest.portals || [];
    if (portals.length === 0) return;

    this.m_portalGroup = new THREE.Group();
    this.m_portalGroup.renderOrder = 5;

    const portalTex = manifest.portalSprite ? (spriteTextures || new Map()).get(manifest.portalSprite) : null;

    for (const portal of portals) {
      const bg = this._CellToBgPixel(portal.x, portal.y);
      const flThreeX = bg.nX - this.m_nBgW / 2;
      const flThreeY = this.m_nBgH / 2 - bg.nY;

      if (portalTex) {
        if (!this.m_portalMaterial) {
          this.m_portalMaterial = new THREE.ShaderMaterial({
            uniforms: {
              uPortalTex: { value: portalTex },
              uTime: { value: 0.0 }
            },
            vertexShader: PORTAL_VS,
            fragmentShader: PORTAL_FS,
            transparent: true,
            depthTest: false,
            side: THREE.DoubleSide
          });
        }
        const geo = new THREE.PlaneGeometry(260, 130);
        const mesh = new THREE.Mesh(geo, this.m_portalMaterial);
        mesh.position.set(flThreeX, flThreeY, 0);
        mesh.renderOrder = 5;
        this.m_portalGroup.add(mesh);
      } else {
        const positions = new Float32Array([
          0, 16, 0, 32, 0, 0, 0, -16, 0, -32, 0, 0
        ]);
        const indices = [0, 1, 2, 0, 2, 3];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setIndex(indices);
        const mat = new THREE.MeshBasicMaterial({
          color: 0x00FFFF, transparent: true, opacity: 0.4,
          depthTest: false, side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(flThreeX, flThreeY, 0);
        mesh.renderOrder = 5;
        this.m_portalGroup.add(mesh);

        const borderPos = new Float32Array([
          0, 16, 0, 32, 0, 0, 32, 0, 0, 0, -16, 0,
          0, -16, 0, -32, 0, 0, -32, 0, 0, 0, 16, 0
        ]);
        const borderGeo = new THREE.BufferGeometry();
        borderGeo.setAttribute('position', new THREE.BufferAttribute(borderPos, 3));
        const borderMat = new THREE.LineBasicMaterial({
          color: 0x00FFFF, depthTest: false
        });
        const borderLine = new THREE.LineSegments(borderGeo, borderMat);
        borderLine.position.set(flThreeX, flThreeY, 0);
        borderLine.renderOrder = 6;
        this.m_portalGroup.add(borderLine);
      }
    }

    this.m_scene.add(this.m_portalGroup);
  }

  _BuildEffects(manifest) {
    const effects = manifest.effects || [];
    if (effects.length === 0) return;

    this.m_effectGroup = new THREE.Group();
    this.m_effectGroup.renderOrder = 5;
    const coord = manifest.coord;

    for (const effect of effects) {
      const flBgX = effect.wx - coord.bgWorldX;
      const flBgY = effect.wy - coord.bgWorldY;
      const flThreeX = flBgX - this.m_nBgW / 2;
      const flThreeY = this.m_nBgH / 2 - flBgY;

      const geo = new THREE.PlaneGeometry(12, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xFFFF00,
        transparent: true,
        opacity: 0.8,
        depthTest: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(flThreeX, flThreeY, 0);
      mesh.renderOrder = 5;
      this.m_effectGroup.add(mesh);
    }

    this.m_scene.add(this.m_effectGroup);
  }

  _BuildSounds(manifest) {
    const sounds = manifest.sounds || [];
    if (sounds.length === 0) return;

    this.m_soundGroup = new THREE.Group();
    this.m_soundGroup.renderOrder = 4;
    const coord = manifest.coord;
    const flTotalPx = manifest.puzzle.cols * manifest.puzzle.tilePx;
    const flPxPerCell = (manifest.size.w > 0) ? flTotalPx / manifest.size.w : 64.0;

    for (const sound of sounds) {
      const flBgX = sound.wx - coord.bgWorldX;
      const flBgY = sound.wy - coord.bgWorldY;
      const flThreeX = flBgX - this.m_nBgW / 2;
      const flThreeY = this.m_nBgH / 2 - flBgY;

      if (sound.range > 0) {
        const flRangePx = sound.range * flPxPerCell;
        const rangeGeo = new THREE.RingGeometry(flRangePx - 1, flRangePx + 1, 64);
        const rangeMat = new THREE.MeshBasicMaterial({
          color: 0x64FF64,
          transparent: true,
          opacity: 0.6,
          depthTest: false,
          side: THREE.DoubleSide
        });
        const rangeMesh = new THREE.Mesh(rangeGeo, rangeMat);
        rangeMesh.position.set(flThreeX, flThreeY, 0);
        rangeMesh.renderOrder = 4;
        this.m_soundGroup.add(rangeMesh);
      }

      const centerGeo = new THREE.CircleGeometry(8, 12);
      const centerMat = new THREE.MeshBasicMaterial({
        color: 0x64FF64,
        transparent: true,
        opacity: 0.7,
        depthTest: false
      });
      const centerMesh = new THREE.Mesh(centerGeo, centerMat);
      centerMesh.position.set(flThreeX, flThreeY, 0);
      centerMesh.renderOrder = 5;
      this.m_soundGroup.add(centerMesh);
    }

    this.m_scene.add(this.m_soundGroup);
  }

  _BuildNpcs(vecNpcs) {
    if (vecNpcs.length === 0) return;

    this.m_npcGroup = new THREE.Group();
    this.m_npcGroup.renderOrder = 6;

    for (const npc of vecNpcs) {
      const bg = this._CellToBgPixel(npc.nX, npc.nY);
      const flThreeX = bg.nX - this.m_nBgW / 2;
      const flThreeY = this.m_nBgH / 2 - bg.nY;

      const positions = new Float32Array([
        0, 16, 0, 32, 0, 0, 0, -16, 0, -32, 0, 0
      ]);
      const indices = [0, 1, 2, 0, 2, 3];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(indices);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xFF8800, transparent: true, opacity: 0.5,
        depthTest: false, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(flThreeX, flThreeY, 0);
      mesh.renderOrder = 6;
      this.m_npcGroup.add(mesh);

      const borderPos = new Float32Array([
        0, 16, 0, 32, 0, 0, 32, 0, 0, 0, -16, 0,
        0, -16, 0, -32, 0, 0, -32, 0, 0, 0, 16, 0
      ]);
      const borderGeo = new THREE.BufferGeometry();
      borderGeo.setAttribute('position', new THREE.BufferAttribute(borderPos, 3));
      const borderMat = new THREE.LineBasicMaterial({ color: 0xFF8800, depthTest: false });
      const borderLine = new THREE.LineSegments(borderGeo, borderMat);
      borderLine.position.set(flThreeX, flThreeY, 0);
      borderLine.renderOrder = 7;
      this.m_npcGroup.add(borderLine);
    }

    this.m_scene.add(this.m_npcGroup);
  }

  _BuildMobs(vecMobSpawns) {
    if (vecMobSpawns.length === 0) return;

    this.m_mobGroup = new THREE.Group();
    this.m_mobGroup.renderOrder = 6;

    for (const spawn of vecMobSpawns) {
      const nCenterX = spawn.nBoundX + Math.floor(spawn.nBoundCX / 2);
      const nCenterY = spawn.nBoundY + Math.floor(spawn.nBoundCY / 2);
      const bg = this._CellToBgPixel(nCenterX, nCenterY);
      const flThreeX = bg.nX - this.m_nBgW / 2;
      const flThreeY = this.m_nBgH / 2 - bg.nY;

      const geo = new THREE.CircleGeometry(10, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xFF4444, transparent: true, opacity: 0.6,
        depthTest: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(flThreeX, flThreeY, 0);
      mesh.renderOrder = 6;
      this.m_mobGroup.add(mesh);

      if (spawn.nBoundCX > 0 && spawn.nBoundCY > 0) {
        const bgTL = this._CellToBgPixel(spawn.nBoundX, spawn.nBoundY);
        const bgTR = this._CellToBgPixel(spawn.nBoundX + spawn.nBoundCX, spawn.nBoundY);
        const bgBR = this._CellToBgPixel(spawn.nBoundX + spawn.nBoundCX, spawn.nBoundY + spawn.nBoundCY);
        const bgBL = this._CellToBgPixel(spawn.nBoundX, spawn.nBoundY + spawn.nBoundCY);

        const flOffX = -this.m_nBgW / 2;
        const flOffY = this.m_nBgH / 2;

        const borderPos = new Float32Array([
          bgTL.nX + flOffX, flOffY - bgTL.nY, 0,
          bgTR.nX + flOffX, flOffY - bgTR.nY, 0,
          bgTR.nX + flOffX, flOffY - bgTR.nY, 0,
          bgBR.nX + flOffX, flOffY - bgBR.nY, 0,
          bgBR.nX + flOffX, flOffY - bgBR.nY, 0,
          bgBL.nX + flOffX, flOffY - bgBL.nY, 0,
          bgBL.nX + flOffX, flOffY - bgBL.nY, 0,
          bgTL.nX + flOffX, flOffY - bgTL.nY, 0
        ]);
        const borderGeo = new THREE.BufferGeometry();
        borderGeo.setAttribute('position', new THREE.BufferAttribute(borderPos, 3));
        const borderMat = new THREE.LineBasicMaterial({
          color: 0xFF4444, transparent: true, opacity: 0.4, depthTest: false
        });
        const borderLine = new THREE.LineSegments(borderGeo, borderMat);
        borderLine.renderOrder = 6;
        this.m_mobGroup.add(borderLine);
      }
    }

    this.m_scene.add(this.m_mobGroup);
  }

  SetNpcsVisible(bVisible) {
    if (this.m_npcGroup) {
      this.m_npcGroup.visible = bVisible;
      this.m_bDirty = true;
    }
  }

  SetMobsVisible(bVisible) {
    if (this.m_mobGroup) {
      this.m_mobGroup.visible = bVisible;
      this.m_bDirty = true;
    }
  }

  SetAccessColor(nR, nG, nB) {
    if (this.m_overlayUniforms) {
      this.m_overlayUniforms.uColor.value.set(nR / 255, nG / 255, nB / 255);
      this.m_bDirty = true;
    }
  }

  _SetGroupColor(group, nColor) {
    if (!group) return;
    group.traverse((obj) => {
      if (obj.material && obj.material.color) {
        obj.material.color.setHex(nColor);
        obj.material.needsUpdate = true;
      }
    });
    this.m_bDirty = true;
  }

  SetPortalColor(nColor) {
    this._SetGroupColor(this.m_portalGroup, nColor);
    if (this.m_portalMaterial && this.m_portalMaterial.uniforms) return;
  }

  SetEffectColor(nColor) { this._SetGroupColor(this.m_effectGroup, nColor); }
  SetSoundColor(nColor) { this._SetGroupColor(this.m_soundGroup, nColor); }
  SetNpcColor(nColor) { this._SetGroupColor(this.m_npcGroup, nColor); }
  SetMobColor(nColor) { this._SetGroupColor(this.m_mobGroup, nColor); }

  BuildAccessOverlayFromDmap(pDmap, manifest) {
    if (!manifest) manifest = this.m_manifest;
    if (!manifest) return;

    const nW = pDmap.GetWidth();
    const nH = pDmap.GetHeight();

    const texData = new Uint8Array(nW * nH * 4);
    for (let nY = 0; nY < nH; nY++) {
      for (let nX = 0; nX < nW; nX++) {
        const nDstIdx = (nY * nW + nX) * 4;
        const nBlocked = pDmap.GetBlocked(nX, nY) ? 255 : 0;
        texData[nDstIdx] = nBlocked;
        texData[nDstIdx + 1] = 0;
        texData[nDstIdx + 2] = 0;
        texData[nDstIdx + 3] = 255;
      }
    }

    if (this.m_accessTexture) this.m_accessTexture.dispose();
    this.m_accessTexture = new THREE.DataTexture(texData, nW, nH, THREE.RGBAFormat);
    this.m_accessTexture.minFilter = THREE.NearestFilter;
    this.m_accessTexture.magFilter = THREE.NearestFilter;
    this.m_accessTexture.needsUpdate = true;

    this._CreateAccessOverlayMesh(manifest);
    this.m_bDirty = true;
  }

  _CreateAccessOverlayMesh(manifest) {
    if (this.m_overlayMesh) {
      this.m_scene.remove(this.m_overlayMesh);
      this.m_overlayMesh.geometry.dispose();
      this.m_overlayMesh.material.dispose();
    }

    const coord = manifest.coord;

    this.m_overlayUniforms = {
      uAccessTex: { value: this.m_accessTexture },
      uMapSize: { value: new THREE.Vector2(manifest.size.w, manifest.size.h) },
      uBgSize: { value: new THREE.Vector2(this.m_nBgW, this.m_nBgH) },
      uOrigin: { value: new THREE.Vector2(coord.originX, coord.originY) },
      uBgWorldPos: { value: new THREE.Vector2(coord.bgWorldX, coord.bgWorldY) },
      uAlpha: { value: 0.4 },
      uColor: { value: new THREE.Vector3(0.78, 0.2, 0.2) }
    };

    const geo = new THREE.PlaneGeometry(this.m_nBgW, this.m_nBgH);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.m_overlayUniforms,
      vertexShader: ACCESS_OVERLAY_VS,
      fragmentShader: ACCESS_OVERLAY_FS,
      transparent: true,
      depthTest: false
    });

    this.m_overlayMesh = new THREE.Mesh(geo, mat);
    this.m_overlayMesh.renderOrder = 10;
    this.m_overlayMesh.visible = this.m_bShowAccessGrid;
    this.m_scene.add(this.m_overlayMesh);
  }

  SetAccessGridVisible(bVisible) {
    this.m_bShowAccessGrid = bVisible;
    if (this.m_overlayMesh) {
      this.m_overlayMesh.visible = bVisible;
      this.m_bDirty = true;
    }
  }

  SetPortalsVisible(bVisible) {
    if (this.m_portalGroup) {
      this.m_portalGroup.visible = bVisible;
      this.m_bDirty = true;
    }
  }

  SetEffectsVisible(bVisible) {
    if (this.m_effectGroup) {
      this.m_effectGroup.visible = bVisible;
      this.m_bDirty = true;
    }
  }

  SetSoundsVisible(bVisible) {
    if (this.m_soundGroup) {
      this.m_soundGroup.visible = bVisible;
      this.m_bDirty = true;
    }
  }

  SetCoversVisible(bVisible) {
    if (this.m_coverGroup) {
      this.m_coverGroup.visible = bVisible;
      this.m_bDirty = true;
    }
  }

  SetScenesVisible(bVisible) {
    if (this.m_sceneGroup) {
      this.m_sceneGroup.visible = bVisible;
      this.m_bDirty = true;
    }
  }

  SetIsometric(bIso) {
    if (this.m_bIsIso === bIso) return;
    this.m_bIsIso = bIso;
    if (this.m_uniforms) {
      this.m_uniforms.uIso.value = bIso;
    }
    this.m_bDirty = true;
  }

  SetGridVisible(bVisible) {
    this.m_bShowGrid = bVisible;
    this.m_bDirty = true;
  }

  SetCamera(flX, flY, flZoom) {
    this.m_flCamX = flX;
    this.m_flCamY = flY;
    this.m_flZoom = flZoom;
    this.m_bDirty = true;
  }

  Resize() {
    const nW = this.m_container.clientWidth;
    const nH = this.m_container.clientHeight;
    this.m_renderer.setSize(nW, nH);
    this.m_bDirty = true;
  }

  AnimateWebMap(flTime) {
    let bChanged = false;
    for (const anim of this.m_animations) {
      if (anim.nInterval <= 0 || anim.nFrameCount <= 1) continue;
      if (flTime - anim.flLastFrameTime >= anim.nInterval) {
        anim.nCurrentFrame = (anim.nCurrentFrame + 1) % anim.nFrameCount;
        anim.texture.offset.x = anim.nCurrentFrame / anim.nFrameCount;
        anim.flLastFrameTime = flTime;
        bChanged = true;
      }
    }
    if (this.m_portalMaterial && this.m_portalGroup && this.m_portalGroup.visible) {
      if (this.m_flZoom >= 0.3) {
        this.m_portalMaterial.uniforms.uTime.value = flTime;
      }
      bChanged = true;
    }
    if (bChanged) this.m_bDirty = true;
  }

  HasAnimations() {
    return this.m_animations.length > 0;
  }

  Render() {
    if (!this.m_bDirty) return;
    this.m_bDirty = false;

    const nW = this.m_container.clientWidth;
    const nH = this.m_container.clientHeight;
    const flHalfW = nW / (2 * this.m_flZoom);
    const flHalfH = nH / (2 * this.m_flZoom);

    this.m_camera.left = -flHalfW;
    this.m_camera.right = flHalfW;
    this.m_camera.top = flHalfH;
    this.m_camera.bottom = -flHalfH;
    this.m_camera.position.set(this.m_flCamX, this.m_flCamY, 5);
    this.m_camera.updateProjectionMatrix();

    if (this.m_uniforms) {
      this.m_uniforms.uGrid.value = this.m_bShowGrid && this.m_flZoom >= 4.0;
    }

    this.m_renderer.render(this.m_scene, this.m_camera);
  }

  CellCenterWorld(nCx, nCy) {
    if (this.m_bWebMapMode) {
      const bg = this._CellToBgPixel(nCx, nCy);
      return {
        flX: bg.nX - this.m_nBgW / 2,
        flY: this.m_nBgH / 2 - bg.nY
      };
    }
    if (this.m_bIsIso) {
      return {
        flX: (nCx - nCy) - (this.m_nMapW - this.m_nMapH) / 2,
        flY: -(nCx + nCy + 1) / 2 + (this.m_nMapW + this.m_nMapH) / 4
      };
    }
    return {
      flX: nCx - this.m_nMapW / 2 + 0.5,
      flY: this.m_nMapH / 2 - nCy - 0.5
    };
  }

  ScreenToWorld(flSx, flSy) {
    const nVW = this.m_container.clientWidth;
    const nVH = this.m_container.clientHeight;
    return {
      flX: this.m_flCamX + (flSx - nVW / 2) / this.m_flZoom,
      flY: this.m_flCamY + (nVH / 2 - flSy) / this.m_flZoom
    };
  }

  WorldToScreen(flWx, flWy) {
    const nVW = this.m_container.clientWidth;
    const nVH = this.m_container.clientHeight;
    return {
      flX: (flWx - this.m_flCamX) * this.m_flZoom + nVW / 2,
      flY: nVH / 2 - (flWy - this.m_flCamY) * this.m_flZoom
    };
  }

  WorldToCell(flWx, flWy) {
    if (this.m_bWebMapMode) {
      const flBgX = flWx + this.m_nBgW / 2;
      const flBgY = this.m_nBgH / 2 - flWy;
      const m = this.m_manifest.coord;
      const flGwx = flBgX + m.bgWorldX;
      const flGwy = flBgY + m.bgWorldY;
      const flDwx = flGwx - m.originX;
      const flDwy = flGwy - m.originY;
      const flCx = flDwx / 64 + flDwy / 32;
      const flCy = flDwy / 32 - flDwx / 64;
      return { nX: Math.round(flCx), nY: Math.round(flCy) };
    }
    let flCx, flCy;
    if (this.m_bIsIso) {
      flCx = flWx / 2 - flWy + this.m_nMapW / 2;
      flCy = -flWx / 2 - flWy + this.m_nMapH / 2;
    } else {
      flCx = flWx + this.m_nMapW / 2;
      flCy = -flWy + this.m_nMapH / 2;
    }
    return { nX: Math.floor(flCx), nY: Math.floor(flCy) };
  }

  ScreenToCell(flSx, flSy) {
    const w = this.ScreenToWorld(flSx, flSy);
    return this.WorldToCell(w.flX, w.flY);
  }

  CellToScreen(nCx, nCy) {
    const w = this.CellCenterWorld(nCx, nCy);
    return this.WorldToScreen(w.flX, w.flY);
  }

  CenterOnCell(nCx, nCy) {
    const w = this.CellCenterWorld(nCx, nCy);
    this.m_flCamX = w.flX;
    this.m_flCamY = w.flY;
    this.m_bDirty = true;
  }

  MarkDirty() { this.m_bDirty = true; }
}
