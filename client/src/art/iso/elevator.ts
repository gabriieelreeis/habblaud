// Porta de elevador de parede vista de frente (o chamador inclina no plano da parede), com ~62 px de moldura.
import { ramp } from '../core/color';
import { PixelBuf } from '../core/pixbuf';
import type { BufSprite } from '../core/sprite';

const W = 32;
const H = 62;

/** state 0..4 = porta fechada .. totalmente aberta. Âncora no centro da base (linha do chão). */
export function renderTallElevator(state: number): BufSprite {
  const pad = 3;
  const b = new PixelBuf(W + pad * 2, H + pad * 2);
  b.ox = pad;
  b.oy = pad + H; // y = 0 é o chão, valores negativos sobem
  const st = Math.max(0, Math.min(4, Math.round(state)));
  const frame = ramp('#aeb6c2', 0.06);
  const door = ramp('#c9d0d9', 0.05);
  const top = -H;

  // moldura de aço escovado
  b.rect(0, top, W, H, frame.base);
  b.hline(0, W - 1, top, frame.hi);
  b.hline(1, W - 2, top + 1, frame.lt);
  b.vline(0, top, -1, frame.lt);
  b.vline(W - 1, top, -1, frame.dk);
  b.vline(W - 2, top + 2, -1, frame.dk);

  // painel indicador no alto
  const lit = st > 0;
  b.rect(8, top + 3, 16, 7, '#22262f');
  b.hline(8, 23, top + 3, '#3a404c');
  const g = lit ? '#5fd07a' : '#3b4a3f';
  b.set(12, top + 4, g);
  b.hline(11, 13, top + 5, g);
  b.vline(12, top + 4, top + 8, g);
  b.set(11, top + 6, g);
  b.set(13, top + 6, g);
  b.rect(16, top + 5, 6, 1, lit ? '#f2c14e' : '#4a4535');
  b.rect(16, top + 7, 4, 1, lit ? '#f2c14eaa' : '#3a362b');

  // vão (cabine): luz quente, parede do fundo, corrimão e piso
  const ix = 3;
  const iy = top + 13;
  const iw = W - 6;
  const ih = -iy;
  b.rect(ix, iy, iw, ih, '#f3e2bf');
  b.rect(ix, iy, iw, 4, '#fff3d6');
  b.rect(ix + 2, iy + 4, iw - 4, ih - 10, '#e4caa0');
  b.vline(ix + 2, iy + 4, iy + ih - 7, '#cfb283');
  b.vline(ix + iw - 3, iy + 4, iy + ih - 7, '#cfb283');
  b.hline(ix + 2, ix + iw - 3, iy + 24, '#b9c0ca');
  b.hline(ix + 2, ix + iw - 3, iy + 25, '#8e97a4');
  b.rect(ix, iy + ih - 6, iw, 6, '#b89a72');
  b.hline(ix, ix + iw - 1, iy + ih - 6, '#a5865f');

  // folhas deslizantes: cada uma recua 3 px por estado
  const leaf = iw / 2; // 13
  const open = st * 3;
  const drawLeaf = (x0: number, w: number, lit0: boolean) => {
    if (w <= 0) return;
    b.rect(x0, iy, w, ih, door.base);
    b.hline(x0, x0 + w - 1, iy, door.hi);
    b.vline(x0, iy, iy + ih - 1, lit0 ? door.lt : door.base);
    b.vline(x0 + w - 1, iy, iy + ih - 1, door.dk);
    for (let k = 2; k < w - 1; k += 4) b.vline(x0 + k, iy + 3, iy + ih - 4, 'rgba(255,255,255,0.18)');
    b.hline(x0 + 1, x0 + w - 2, iy + ih - 1, door.dk);
  };
  drawLeaf(ix, leaf - open, true);
  drawLeaf(ix + leaf + open, leaf - open, false);
  if (st === 0) b.vline(ix + leaf, iy, iy + ih - 1, door.dd);

  // botoeira lateral
  b.rect(29, top + 36, 2, 7, '#22262f');
  b.set(29, top + 37, lit ? '#f2c14e' : '#6b7282');
  b.set(29, top + 40, '#6b7282');
  // soleira
  b.hline(1, W - 2, -1, frame.dd);

  b.outline();
  return { buf: b, ax: pad + W / 2, ay: pad + H };
}
