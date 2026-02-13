const HEADER_SIZE = 276;
const WIDTH_OFFSET = 268;
const HEIGHT_OFFSET = 272;
const DATA_OFFSET = 276;
const BYTES_PER_CELL = 6;

export default class CDMapFile {
  constructor() {
    this.m_nWidth = 0;
    this.m_nHeight = 0;
    this.m_blocked = null;
    this.m_elevation = null;
  }

  async Load(file) {
    let arrayBuffer;
    if (file instanceof File) {
      arrayBuffer = await file.arrayBuffer();
    } else {
      arrayBuffer = file;
    }

    const buf = new Uint8Array(arrayBuffer);
    if (buf.length < HEADER_SIZE + 4) return false;

    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.m_nWidth = dv.getUint32(WIDTH_OFFSET, true);
    this.m_nHeight = dv.getUint32(HEIGHT_OFFSET, true);

    if (this.m_nWidth === 0 || this.m_nHeight === 0 || this.m_nWidth > 65535 || this.m_nHeight > 65535)
      return false;

    const nExpected = DATA_OFFSET + this.m_nHeight * (this.m_nWidth * BYTES_PER_CELL + 4);
    if (buf.length < nExpected)
      return false;

    const nTotal = this.m_nWidth * this.m_nHeight;
    this.m_blocked = new Uint16Array(nTotal);
    this.m_elevation = new Int16Array(nTotal);

    const nRowStride = this.m_nWidth * BYTES_PER_CELL + 4;
    for (let nY = 0; nY < this.m_nHeight; nY++) {
      const nRowStart = DATA_OFFSET + nY * nRowStride;
      const nRowIdx = nY * this.m_nWidth;
      for (let nX = 0; nX < this.m_nWidth; nX++) {
        const nOff = nRowStart + nX * BYTES_PER_CELL;
        this.m_blocked[nRowIdx + nX] = buf[nOff] | (buf[nOff + 1] << 8);
        this.m_elevation[nRowIdx + nX] = (buf[nOff + 4] | (buf[nOff + 5] << 8)) << 16 >> 16;
      }
    }

    return true;
  }

  GetWidth() { return this.m_nWidth; }
  GetHeight() { return this.m_nHeight; }
  GetBlocked(nX, nY) { return this.m_blocked[nY * this.m_nWidth + nX]; }
  GetElevation(nX, nY) { return this.m_elevation[nY * this.m_nWidth + nX]; }
}
