export const g_surfaceColors = new Array(10);
export const g_blockedColorRGB = [200, 50, 50];
export const g_bgColorRGB = [30, 30, 30];

for (let i = 0; i < 10; i++) {
  const flHue = i / 10.0;
  const flH = flHue * 6.0;
  const nI = Math.floor(flH);
  const flF = flH - nI;
  const flP = 0.3;
  const flQ = 0.3 + 0.6 * (1.0 - flF);
  const flT = 0.3 + 0.6 * flF;
  let flR, flG, flB;

  switch (nI % 6) {
    case 0: flR = 0.9; flG = flT; flB = flP; break;
    case 1: flR = flQ; flG = 0.9; flB = flP; break;
    case 2: flR = flP; flG = 0.9; flB = flT; break;
    case 3: flR = flP; flG = flQ; flB = 0.9; break;
    case 4: flR = flT; flG = flP; flB = 0.9; break;
    case 5: flR = 0.9; flG = flP; flB = flQ; break;
    default: flR = 0.5; flG = 0.5; flB = 0.5; break;
  }

  g_surfaceColors[i] = [(flR * 255) | 0, (flG * 255) | 0, (flB * 255) | 0];
}

export function GetCellRGB(nBlocked, nSurface, bShowBlocked) {
  if (nBlocked) {
    return bShowBlocked ? g_blockedColorRGB : g_bgColorRGB;
  }
  return g_surfaceColors[nSurface % 10];
}
