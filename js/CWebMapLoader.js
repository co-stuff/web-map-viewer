import * as THREE from 'three';

export default class CWebMapLoader {
  constructor() {
    this.m_manifest = null;
    this.m_atlasTextures = [];
    this.m_spriteTextures = new Map();
    this.m_bLoaded = false;
  }

  async Load(fileList) {
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

    const atlasPromises = this.m_manifest.atlases.map(atlas => {
      const file = fileMap.get(atlas.file.toLowerCase());
      if (!file) return Promise.resolve(null);
      return this._LoadImageFile(file);
    });
    this.m_atlasTextures = await Promise.all(atlasPromises);

    const setSpriteFiles = new Set();
    if (this.m_manifest.portalSprite) setSpriteFiles.add(this.m_manifest.portalSprite);
    for (const at of this.m_manifest.animatedTiles || []) setSpriteFiles.add(at.sprite);
    for (const c of this.m_manifest.covers || []) setSpriteFiles.add(c.sprite);
    for (const s of this.m_manifest.scenes || []) {
      for (const p of s.parts || []) setSpriteFiles.add(p.sprite);
    }

    const spriteKeys = [];
    const spritePromises = [];
    for (const szSprite of setSpriteFiles) {
      const file = fileMap.get(szSprite.toLowerCase());
      if (!file) continue;
      spriteKeys.push(szSprite);
      spritePromises.push(this._LoadImageFile(file));
    }

    const spriteResults = await Promise.all(spritePromises);
    for (let i = 0; i < spriteKeys.length; i++) {
      if (spriteResults[i]) this.m_spriteTextures.set(spriteKeys[i], spriteResults[i]);
    }

    this.m_bLoaded = true;
    return true;
  }

  async LoadFromUrl(szBaseUrl) {
    const resp = await fetch(szBaseUrl + '/map.json');
    if (!resp.ok) return false;

    this.m_manifest = await resp.json();

    const atlasPromises = this.m_manifest.atlases.map(atlas =>
      this._LoadImageUrl(szBaseUrl + '/' + atlas.file)
    );
    this.m_atlasTextures = await Promise.all(atlasPromises);

    const setSpriteFiles = new Set();
    if (this.m_manifest.portalSprite) setSpriteFiles.add(this.m_manifest.portalSprite);
    for (const at of this.m_manifest.animatedTiles || []) setSpriteFiles.add(at.sprite);
    for (const c of this.m_manifest.covers || []) setSpriteFiles.add(c.sprite);
    for (const s of this.m_manifest.scenes || []) {
      for (const p of s.parts || []) setSpriteFiles.add(p.sprite);
    }

    const spriteKeys = [];
    const spritePromises = [];
    for (const szSprite of setSpriteFiles) {
      spriteKeys.push(szSprite);
      spritePromises.push(this._LoadImageUrl(szBaseUrl + '/' + szSprite));
    }

    const spriteResults = await Promise.all(spritePromises);
    for (let i = 0; i < spriteKeys.length; i++) {
      if (spriteResults[i]) this.m_spriteTextures.set(spriteKeys[i], spriteResults[i]);
    }

    this.m_bLoaded = true;
    return true;
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
