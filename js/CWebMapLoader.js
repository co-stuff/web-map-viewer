import * as THREE from 'three';
import CDMapFile from './CDMapFile.js';

export default class CWebMapLoader {
  constructor() {
    this.m_manifest = null;
    this.m_atlasTextures = [];
    this.m_spriteTextures = new Map();
    this.m_pDmap = null;
    this.m_bLoaded = false;
    this.m_vecMobs = [];
    this.m_vecMobSpawns = [];
    this.m_vecNpcs = [];
  }

  _ParseIniSections(szText) {
    const vecSections = [];
    let current = null;
    for (const szLine of szText.split('\n')) {
      const szTrimmed = szLine.trim();
      if (!szTrimmed || szTrimmed.startsWith(';') || szTrimmed.startsWith('#')) continue;
      const matchSection = szTrimmed.match(/^\[(.+)\]$/);
      if (matchSection) {
        current = { szName: matchSection[1], mapKV: {} };
        vecSections.push(current);
        continue;
      }
      if (!current) continue;
      const nEq = szTrimmed.indexOf('=');
      if (nEq < 0) continue;
      current.mapKV[szTrimmed.substring(0, nEq).trim().toLowerCase()] = szTrimmed.substring(nEq + 1).trim();
    }
    return vecSections;
  }

  _ParseMobsIni(szText) {
    const vecSections = this._ParseIniSections(szText);
    this.m_vecMobs = vecSections.map(s => ({
      nId: parseInt(s.mapKV['id']) || 0,
      szName: s.mapKV['name'] || '',
      nLevel: parseInt(s.mapKV['level']) || 0,
      nLife: parseInt(s.mapKV['life']) || 0,
      nAttackMin: parseInt(s.mapKV['attack_min']) || 0,
      nAttackMax: parseInt(s.mapKV['attack_max']) || 0,
      nDefence: parseInt(s.mapKV['defence']) || 0,
      nLookface: parseInt(s.mapKV['lookface']) || 0
    }));
  }

  _ParseMobSpawnIni(szText) {
    const vecSections = this._ParseIniSections(szText);
    this.m_vecMobSpawns = vecSections.map(s => ({
      nId: parseInt(s.mapKV['id']) || 0,
      nNpcType: parseInt(s.mapKV['npctype']) || 0,
      szName: s.mapKV['name'] || '',
      nBoundX: parseInt(s.mapKV['bound_x']) || 0,
      nBoundY: parseInt(s.mapKV['bound_y']) || 0,
      nBoundCX: parseInt(s.mapKV['bound_cx']) || 0,
      nBoundCY: parseInt(s.mapKV['bound_cy']) || 0,
      nMaxNpc: parseInt(s.mapKV['maxnpc']) || 0
    }));
  }

  _ParseNpcsIni(szText) {
    const vecSections = this._ParseIniSections(szText);
    this.m_vecNpcs = vecSections.map(s => ({
      nNpcId: parseInt(s.mapKV['npcid']) || 0,
      nNpcType: parseInt(s.mapKV['npctype']) || 0,
      szName: s.mapKV['name'] || '',
      nX: parseInt(s.mapKV['x']) || 0,
      nY: parseInt(s.mapKV['y']) || 0,
      nFlag: parseInt(s.mapKV['flag']) || 0,
      nInteraction: parseInt(s.mapKV['interaction']) || 0
    }));
  }

  _CollectSpriteFiles() {
    const set = new Set();
    if (this.m_manifest.portalSprite) set.add(this.m_manifest.portalSprite);
    for (const at of this.m_manifest.animatedTiles || []) set.add(at.sprite);
    for (const c of this.m_manifest.covers || []) set.add(c.sprite);
    for (const s of this.m_manifest.scenes || []) {
      for (const p of s.parts || []) set.add(p.sprite);
    }
    return set;
  }

  async Load(fileList, fnProgress) {
    let manifestFile = null;
    const fileMap = new Map();

    for (const file of fileList) {
      const szRelPath = file.webkitRelativePath || file.name;
      const parts = szRelPath.split('/');
      const szLocal = parts.slice(1).join('/');
      fileMap.set(szLocal.toLowerCase(), file);

      if (file.name.toLowerCase() === 'map.json') {
        manifestFile = file;
      }
    }

    if (!manifestFile) return false;

    const szText = await manifestFile.text();
    this.m_manifest = JSON.parse(szText);

    const setSpriteFiles = this._CollectSpriteFiles();
    const nAtlasCount = this.m_manifest.atlases.length;
    const nSpriteCount = setSpriteFiles.size;
    const nTotal = nAtlasCount + nSpriteCount + 1;
    let nDone = 0;
    if (fnProgress) fnProgress(0, nTotal, 'Loading manifest...');

    const atlasPromises = this.m_manifest.atlases.map(atlas => {
      const file = fileMap.get(atlas.file.toLowerCase());
      if (!file) return Promise.resolve(null);
      return this._LoadImageFile(file).then(tex => {
        nDone++;
        if (fnProgress) fnProgress(nDone, nTotal, `Loading atlas ${nDone}/${nAtlasCount}...`);
        return tex;
      });
    });
    this.m_atlasTextures = await Promise.all(atlasPromises);

    const spriteKeys = [];
    const spritePromises = [];
    for (const szSprite of setSpriteFiles) {
      const file = fileMap.get(szSprite.toLowerCase());
      if (!file) continue;
      spriteKeys.push(szSprite);
      spritePromises.push(this._LoadImageFile(file).then(tex => {
        nDone++;
        if (fnProgress) fnProgress(nDone, nTotal, `Loading sprite ${nDone - nAtlasCount}/${nSpriteCount}...`);
        return tex;
      }));
    }

    const spriteResults = await Promise.all(spritePromises);
    for (let i = 0; i < spriteKeys.length; i++) {
      if (spriteResults[i]) this.m_spriteTextures.set(spriteKeys[i], spriteResults[i]);
    }

    if (this.m_manifest.dmapFile) {
      const dmapFileEntry = fileMap.get(this.m_manifest.dmapFile.toLowerCase());
      if (dmapFileEntry) {
        const pDmap = new CDMapFile();
        if (await pDmap.Load(dmapFileEntry)) this.m_pDmap = pDmap;
      }
    }

    await this._LoadIniFiles((szName) => {
      const f = fileMap.get(szName.toLowerCase());
      return f ? f.text() : Promise.resolve(null);
    });

    if (fnProgress) fnProgress(nTotal, nTotal, 'Building scene...');
    this.m_bLoaded = true;
    return true;
  }

  async LoadFromUrl(szBaseUrl, fnProgress) {
    if (fnProgress) fnProgress(0, 0, 'Fetching manifest...');
    const resp = await fetch(szBaseUrl + '/map.json');
    if (!resp.ok) return false;

    this.m_manifest = await resp.json();

    const setSpriteFiles = this._CollectSpriteFiles();
    const nAtlasCount = this.m_manifest.atlases.length;
    const nSpriteCount = setSpriteFiles.size;
    const nTotal = nAtlasCount + nSpriteCount + 1;
    let nDone = 0;
    if (fnProgress) fnProgress(0, nTotal, 'Loading manifest...');

    const atlasPromises = this.m_manifest.atlases.map(atlas =>
      this._LoadImageUrl(szBaseUrl + '/' + atlas.file).then(tex => {
        nDone++;
        if (fnProgress) fnProgress(nDone, nTotal, `Loading atlas ${nDone}/${nAtlasCount}...`);
        return tex;
      })
    );
    this.m_atlasTextures = await Promise.all(atlasPromises);

    const spriteKeys = [];
    const spritePromises = [];
    for (const szSprite of setSpriteFiles) {
      spriteKeys.push(szSprite);
      spritePromises.push(this._LoadImageUrl(szBaseUrl + '/' + szSprite).then(tex => {
        nDone++;
        if (fnProgress) fnProgress(nDone, nTotal, `Loading sprite ${nDone - nAtlasCount}/${nSpriteCount}...`);
        return tex;
      }));
    }

    const spriteResults = await Promise.all(spritePromises);
    for (let i = 0; i < spriteKeys.length; i++) {
      if (spriteResults[i]) this.m_spriteTextures.set(spriteKeys[i], spriteResults[i]);
    }

    if (this.m_manifest.dmapFile) {
      try {
        const dmapResp = await fetch(szBaseUrl + '/' + this.m_manifest.dmapFile);
        if (dmapResp.ok) {
          const pDmap = new CDMapFile();
          if (await pDmap.Load(await dmapResp.arrayBuffer())) this.m_pDmap = pDmap;
        }
      } catch (e) {}
    }

    await this._LoadIniFiles(async (szName) => {
      try {
        const resp = await fetch(szBaseUrl + '/' + szName);
        return resp.ok ? await resp.text() : null;
      } catch (e) { return null; }
    });

    if (fnProgress) fnProgress(nTotal, nTotal, 'Building scene...');
    this.m_bLoaded = true;
    return true;
  }

  async LoadFromZipBlob(blob, fnProgress) {
    if (fnProgress) fnProgress(0, 0, 'Decompressing archive...');
    const zip = await JSZip.loadAsync(blob);

    let manifestEntry = null;
    zip.forEach((szPath, entry) => {
      if (szPath.toLowerCase().endsWith('map.json') && !entry.dir)
        manifestEntry = entry;
    });
    if (!manifestEntry) return false;

    const szText = await manifestEntry.async('string');
    this.m_manifest = JSON.parse(szText);

    const setSpriteFiles = this._CollectSpriteFiles();
    const nAtlasCount = this.m_manifest.atlases.length;
    const nSpriteCount = setSpriteFiles.size;
    const nTotal = nAtlasCount + nSpriteCount + 1;
    let nDone = 0;
    if (fnProgress) fnProgress(0, nTotal, 'Loading manifest...');

    const fnLoadImageFromZip = (szName) => {
      let entry = zip.file(szName);
      if (!entry) {
        zip.forEach((szPath, e) => {
          if (szPath.toLowerCase() === szName.toLowerCase() && !e.dir)
            entry = e;
        });
      }
      if (!entry) return Promise.resolve(null);
      return entry.async('blob').then(blob => this._LoadImageBlob(blob));
    };

    const atlasPromises = this.m_manifest.atlases.map(atlas =>
      fnLoadImageFromZip(atlas.file).then(tex => {
        nDone++;
        if (fnProgress) fnProgress(nDone, nTotal, `Loading atlas ${nDone}/${nAtlasCount}...`);
        return tex;
      })
    );
    this.m_atlasTextures = await Promise.all(atlasPromises);

    const spriteKeys = [];
    const spritePromises = [];
    for (const szSprite of setSpriteFiles) {
      spriteKeys.push(szSprite);
      spritePromises.push(fnLoadImageFromZip(szSprite).then(tex => {
        nDone++;
        if (fnProgress) fnProgress(nDone, nTotal, `Loading sprite ${nDone - nAtlasCount}/${nSpriteCount}...`);
        return tex;
      }));
    }
    const spriteResults = await Promise.all(spritePromises);
    for (let i = 0; i < spriteKeys.length; i++) {
      if (spriteResults[i]) this.m_spriteTextures.set(spriteKeys[i], spriteResults[i]);
    }

    const fnLoadTextFromZip = (szName) => {
      let entry = zip.file(szName);
      if (!entry) {
        zip.forEach((szPath, e) => {
          if (szPath.toLowerCase() === szName.toLowerCase() && !e.dir)
            entry = e;
        });
      }
      if (!entry) return Promise.resolve(null);
      return entry.async('string');
    };

    if (this.m_manifest.dmapFile) {
      try {
        const fnLoadBinaryFromZip = (szName) => {
          let entry = zip.file(szName);
          if (!entry) {
            zip.forEach((szPath, e) => {
              if (szPath.toLowerCase() === szName.toLowerCase() && !e.dir)
                entry = e;
            });
          }
          if (!entry) return Promise.resolve(null);
          return entry.async('arraybuffer');
        };
        const dmapBuf = await fnLoadBinaryFromZip(this.m_manifest.dmapFile);
        if (dmapBuf) {
          const pDmap = new CDMapFile();
          if (await pDmap.Load(dmapBuf)) this.m_pDmap = pDmap;
        }
      } catch (e) { console.error('[dmap] error:', e); }
    }

    await this._LoadIniFiles(fnLoadTextFromZip);

    if (fnProgress) fnProgress(nTotal, nTotal, 'Building scene...');
    this.m_bLoaded = true;
    return true;
  }

  async LoadFromZipUrl(szUrl, fnProgress) {
    if (fnProgress) fnProgress(0, 0, 'Downloading archive...');
    const resp = await fetch(szUrl);
    if (!resp.ok) return false;
    const blob = await resp.blob();
    return this.LoadFromZipBlob(blob, fnProgress);
  }

  async _LoadIniFiles(fnReadText) {
    const m = this.m_manifest;
    if (m.mobsFile) {
      const szText = await fnReadText(m.mobsFile);
      if (szText) this._ParseMobsIni(szText);
    }
    if (m.mobsSpawnFile) {
      const szText = await fnReadText(m.mobsSpawnFile);
      if (szText) this._ParseMobSpawnIni(szText);
    }
    if (m.npcsFile) {
      const szText = await fnReadText(m.npcsFile);
      if (szText) this._ParseNpcsIni(szText);
    }
  }

  _LoadImageBlob(blob) {
    return new Promise((resolve) => {
      const szUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        URL.revokeObjectURL(szUrl);
        resolve(tex);
      };
      img.onerror = () => { URL.revokeObjectURL(szUrl); resolve(null); };
      img.src = szUrl;
    });
  }

  _LoadImageUrl(szUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        resolve(tex);
      };
      img.onerror = () => resolve(null);
      img.src = szUrl;
    });
  }

  _LoadImageFile(file) {
    return new Promise((resolve) => {
      const szUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        URL.revokeObjectURL(szUrl);
        resolve(tex);
      };
      img.onerror = () => {
        URL.revokeObjectURL(szUrl);
        resolve(null);
      };
      img.src = szUrl;
    });
  }
}
