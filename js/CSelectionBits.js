export default class CSelectionBits {
  constructor() {
    this.m_nWidth = 0;
    this.m_nHeight = 0;
    this.m_bits = null;
    this.m_nSelectedCount = 0;
  }

  Init(nWidth, nHeight) {
    this.m_nWidth = nWidth;
    this.m_nHeight = nHeight;
    this.m_bits = new Uint8Array(((nWidth * nHeight + 7) >> 3));
    this.m_nSelectedCount = 0;
  }

  SelectCell(nX, nY) {
    if (nX < 0 || nY < 0 || nX >= this.m_nWidth || nY >= this.m_nHeight) return;
    const nIdx = nY * this.m_nWidth + nX;
    const nBit = 1 << (nIdx & 7);
    if (!(this.m_bits[nIdx >> 3] & nBit)) {
      this.m_bits[nIdx >> 3] |= nBit;
      this.m_nSelectedCount++;
    }
  }

  DeselectCell(nX, nY) {
    if (nX < 0 || nY < 0 || nX >= this.m_nWidth || nY >= this.m_nHeight) return;
    const nIdx = nY * this.m_nWidth + nX;
    const nBit = 1 << (nIdx & 7);
    if (this.m_bits[nIdx >> 3] & nBit) {
      this.m_bits[nIdx >> 3] &= ~nBit;
      this.m_nSelectedCount--;
    }
  }

  IsCellSelected(nX, nY) {
    if (nX < 0 || nY < 0 || nX >= this.m_nWidth || nY >= this.m_nHeight) return false;
    const nIdx = nY * this.m_nWidth + nX;
    return (this.m_bits[nIdx >> 3] >> (nIdx & 7)) & 1;
  }

  ClearSelection() {
    if (this.m_nSelectedCount > 0) {
      this.m_bits.fill(0);
      this.m_nSelectedCount = 0;
    }
  }

  SelectAll() {
    this.m_bits.fill(0xFF);
    this.m_nSelectedCount = this.m_nWidth * this.m_nHeight;
  }

  GetSelectedCount() { return this.m_nSelectedCount; }
}
