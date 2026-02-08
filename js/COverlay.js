export default class COverlay {
  constructor(canvas) {
    this.m_canvas = canvas;
    this.m_ctx = canvas.getContext('2d');
  }

  Resize(nW, nH) {
    this.m_canvas.width = nW;
    this.m_canvas.height = nH;
  }

  Clear() {
    this.m_ctx.clearRect(0, 0, this.m_canvas.width, this.m_canvas.height);
  }

  Render(renderer, selBits, nHoverX, nHoverY, pDmap, bShowElev) {
    this.Clear();
    if (!pDmap) return;

    const nMapW = pDmap.GetWidth();
    const nMapH = pDmap.GetHeight();
    const flZoom = renderer.m_flZoom;
    const ctx = this.m_ctx;

    if (flZoom < 3) {
      this.RenderSelOnly(renderer, selBits, nHoverX, nHoverY, nMapW, nMapH);
      return;
    }

    const nVW = this.m_canvas.width;
    const nVH = this.m_canvas.height;

    const tl = renderer.ScreenToCell(0, 0);
    const tr = renderer.ScreenToCell(nVW, 0);
    const bl = renderer.ScreenToCell(0, nVH);
    const br = renderer.ScreenToCell(nVW, nVH);
    const nStartX = Math.max(0, Math.min(tl.nX, tr.nX, bl.nX, br.nX) - 2);
    const nEndX = Math.min(nMapW, Math.max(tl.nX, tr.nX, bl.nX, br.nX) + 3);
    const nStartY = Math.max(0, Math.min(tl.nY, tr.nY, bl.nY, br.nY) - 2);
    const nEndY = Math.min(nMapH, Math.max(tl.nY, tr.nY, bl.nY, br.nY) + 3);

    for (let nY = nStartY; nY < nEndY; nY++) {
      for (let nX = nStartX; nX < nEndX; nX++) {
        const bSel = selBits.IsCellSelected(nX, nY);
        const bHover = (nX === nHoverX && nY === nHoverY);

        if (!bSel && !bHover && !bShowElev) continue;

        if (bSel) {
          this.DrawCellHighlight(renderer, nX, nY, 'rgba(100,150,255,0.3)', 'rgba(100,150,255,1.0)', 2);
        } else if (bHover) {
          this.DrawCellHighlight(renderer, nX, nY, 'rgba(100,150,255,0.15)', 'rgba(100,150,255,0.6)', 1);
        }

        if (bShowElev && flZoom >= 10) {
          const nElev = pDmap.GetElevation(nX, nY);
          if (nElev !== 0) {
            const sc = renderer.CellToScreen(nX, nY);
            ctx.font = '10px Consolas,monospace';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(nElev), sc.flX, sc.flY);
          }
        }
      }
    }
  }

  DrawCellHighlight(renderer, nCellX, nCellY, szFill, szStroke, nLineW) {
    const ctx = this.m_ctx;
    const sc = renderer.CellToScreen(nCellX, nCellY);

    if (renderer.m_bIsIso) {
      const flHalfW = renderer.m_flZoom;
      const flHalfH = renderer.m_flZoom * 0.5;
      ctx.beginPath();
      ctx.moveTo(sc.flX, sc.flY - flHalfH);
      ctx.lineTo(sc.flX + flHalfW, sc.flY);
      ctx.lineTo(sc.flX, sc.flY + flHalfH);
      ctx.lineTo(sc.flX - flHalfW, sc.flY);
      ctx.closePath();
      ctx.fillStyle = szFill;
      ctx.fill();
      ctx.strokeStyle = szStroke;
      ctx.lineWidth = nLineW;
      ctx.stroke();
    } else {
      const flZ = renderer.m_flZoom;
      ctx.fillStyle = szFill;
      ctx.fillRect(sc.flX - flZ / 2, sc.flY - flZ / 2, flZ, flZ);
      ctx.strokeStyle = szStroke;
      ctx.lineWidth = nLineW;
      ctx.strokeRect(sc.flX - flZ / 2, sc.flY - flZ / 2, flZ, flZ);
    }
  }

  RenderSelOnly(renderer, selBits, nHoverX, nHoverY, nMapW, nMapH) {
    if (selBits.GetSelectedCount() === 0 && nHoverX < 0) return;

    if (nHoverX >= 0 && nHoverX < nMapW && nHoverY >= 0 && nHoverY < nMapH) {
      this.DrawCellHighlight(renderer, nHoverX, nHoverY, 'rgba(100,150,255,0.3)', 'rgba(100,150,255,0.6)', 1);
    }
  }

  RenderSelectionBox(flMinX, flMinY, flMaxX, flMaxY) {
    const ctx = this.m_ctx;
    ctx.fillStyle = 'rgba(100,150,255,0.2)';
    ctx.fillRect(flMinX, flMinY, flMaxX - flMinX, flMaxY - flMinY);
    ctx.strokeStyle = 'rgba(100,150,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(flMinX, flMinY, flMaxX - flMinX, flMaxY - flMinY);
  }
}
