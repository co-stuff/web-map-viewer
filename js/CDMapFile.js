const HEADER_SIZE = 276;
const WIDTH_OFFSET = 268;
const HEIGHT_OFFSET = 272;
const DATA_OFFSET = 276;
const BYTES_PER_CELL = 6;

export default class CDMapFile {
  constructor() {
    this.m_nWidth = 0;
    this.m_nHeight = 0;
    this.m_bDirty = false;
    this.m_szFilename = '';
    this.m_buffer = null;
    this.m_blocked = null;
    this.m_surface = null;
    this.m_elevation = null;
  }

  async Load(file) {
    let arrayBuffer;
    if (file instanceof File) {
      arrayBuffer = await file.arrayBuffer();
      this.m_szFilename = file.name;
    } else {
      arrayBuffer = file;
    }

    this.m_buffer = new Uint8Array(arrayBuffer);
    if (this.m_buffer.length < HEADER_SIZE + 4) return false;

    const dv = new DataView(this.m_buffer.buffer, this.m_buffer.byteOffset, this.m_buffer.byteLength);
    this.m_nWidth = dv.getUint32(WIDTH_OFFSET, true);
    this.m_nHeight = dv.getUint32(HEIGHT_OFFSET, true);

    this.ParseCellsFromBuffer();
    this.m_bDirty = false;
    return true;
  }

  ParseCellsFromBuffer() {
    const nTotal = this.m_nWidth * this.m_nHeight;
    this.m_blocked = new Uint16Array(nTotal);
    this.m_surface = new Uint16Array(nTotal);
    this.m_elevation = new Int16Array(nTotal);

    const buf = this.m_buffer;
    const nRowStride = this.m_nWidth * BYTES_PER_CELL + 4;

    for (let nY = 0; nY < this.m_nHeight; nY++) {
      const nRowStart = DATA_OFFSET + nY * nRowStride;
      const nRowIdx = nY * this.m_nWidth;
      for (let nX = 0; nX < this.m_nWidth; nX++) {
        const nOff = nRowStart + nX * BYTES_PER_CELL;
        this.m_blocked[nRowIdx + nX] = buf[nOff] | (buf[nOff + 1] << 8);
        this.m_surface[nRowIdx + nX] = buf[nOff + 2] | (buf[nOff + 3] << 8);
        this.m_elevation[nRowIdx + nX] = (buf[nOff + 4] | (buf[nOff + 5] << 8)) << 16 >> 16;
      }
    }
  }

  Save() {
    if (!this.m_buffer) return null;
    const nRowStride = this.m_nWidth * BYTES_PER_CELL + 4;

    for (let nY = 0; nY < this.m_nHeight; nY++) {
      const nRowStart = DATA_OFFSET + nY * nRowStride;
      const nRowIdx = nY * this.m_nWidth;
      for (let nX = 0; nX < this.m_nWidth; nX++) {
        const nOff = nRowStart + nX * BYTES_PER_CELL;
        const nBlocked = this.m_blocked[nRowIdx + nX];
        const nSurface = this.m_surface[nRowIdx + nX];
        const nElev = this.m_elevation[nRowIdx + nX] & 0xFFFF;
        this.m_buffer[nOff] = nBlocked & 0xFF;
        this.m_buffer[nOff + 1] = (nBlocked >> 8) & 0xFF;
        this.m_buffer[nOff + 2] = nSurface & 0xFF;
        this.m_buffer[nOff + 3] = (nSurface >> 8) & 0xFF;
        this.m_buffer[nOff + 4] = nElev & 0xFF;
        this.m_buffer[nOff + 5] = (nElev >> 8) & 0xFF;
      }
      this.UpdateRowChecksum(nY);
    }

    this.m_bDirty = false;
    return new Blob([this.m_buffer], { type: 'application/octet-stream' });
  }

  GetWidth() { return this.m_nWidth; }
  GetHeight() { return this.m_nHeight; }
  GetFilename() { return this.m_szFilename; }
  IsDirty() { return this.m_bDirty; }

  GetBlocked(nX, nY) { return this.m_blocked[nY * this.m_nWidth + nX]; }
  GetSurface(nX, nY) { return this.m_surface[nY * this.m_nWidth + nX]; }
  GetElevation(nX, nY) { return this.m_elevation[nY * this.m_nWidth + nX]; }

  SetCellBlocked(nX, nY, nValue) {
    this.m_blocked[nY * this.m_nWidth + nX] = nValue;
    const nOff = this.CalculateCellOffset(nX, nY);
    this.m_buffer[nOff] = nValue & 0xFF;
    this.m_buffer[nOff + 1] = (nValue >> 8) & 0xFF;
    this.m_bDirty = true;
    this.UpdateRowChecksum(nY);
  }

  SetCellSurface(nX, nY, nValue) {
    this.m_surface[nY * this.m_nWidth + nX] = nValue;
    const nOff = this.CalculateCellOffset(nX, nY);
    this.m_buffer[nOff + 2] = nValue & 0xFF;
    this.m_buffer[nOff + 3] = (nValue >> 8) & 0xFF;
    this.m_bDirty = true;
    this.UpdateRowChecksum(nY);
  }

  SetCellElevation(nX, nY, nValue) {
    this.m_elevation[nY * this.m_nWidth + nX] = nValue;
    const nOff = this.CalculateCellOffset(nX, nY);
    const nUval = nValue & 0xFFFF;
    this.m_buffer[nOff + 4] = nUval & 0xFF;
    this.m_buffer[nOff + 5] = (nUval >> 8) & 0xFF;
    this.m_bDirty = true;
    this.UpdateRowChecksum(nY);
  }

  CalculateCellOffset(nX, nY) {
    return DATA_OFFSET + (nY * ((this.m_nWidth * BYTES_PER_CELL) + 4)) + (nX * BYTES_PER_CELL);
  }

  CalculateRowChecksum(nY) {
    let nChecksum = 0;
    const nStart = DATA_OFFSET + (nY * ((this.m_nWidth * BYTES_PER_CELL) + 4));
    for (let nX = 0; nX < this.m_nWidth; nX++) {
      const nCellOffset = nStart + (nX * BYTES_PER_CELL);
      const nBlocked = this.m_buffer[nCellOffset] | (this.m_buffer[nCellOffset + 1] << 8);
      const nSurface = this.m_buffer[nCellOffset + 2] | (this.m_buffer[nCellOffset + 3] << 8);
      const nElevation = this.m_buffer[nCellOffset + 4] | (this.m_buffer[nCellOffset + 5] << 8);
      nChecksum = (nChecksum + nBlocked * (nSurface + nY + 1) + (nElevation + 2) * (nSurface + nX + 1)) >>> 0;
    }
    return nChecksum;
  }

  UpdateRowChecksum(nY) {
    const nChecksum = this.CalculateRowChecksum(nY);
    const nOff = DATA_OFFSET + (nY * ((this.m_nWidth * BYTES_PER_CELL) + 4)) + (this.m_nWidth * BYTES_PER_CELL);
    this.m_buffer[nOff] = nChecksum & 0xFF;
    this.m_buffer[nOff + 1] = (nChecksum >> 8) & 0xFF;
    this.m_buffer[nOff + 2] = (nChecksum >> 16) & 0xFF;
    this.m_buffer[nOff + 3] = (nChecksum >> 24) & 0xFF;
  }
}
