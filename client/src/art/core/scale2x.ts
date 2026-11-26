// Ampliação 2x de pixel art (Scale2x/EPX): dobra o tamanho arredondando as diagonais em vez de só repetir pixels.
import { PixelBuf } from './pixbuf';

export function scale2x(src: PixelBuf): PixelBuf {
  const { w, h } = src;
  const s = new Uint32Array(src.data.buffer, src.data.byteOffset, w * h);
  const out = new PixelBuf(w * 2, h * 2);
  const o = new Uint32Array(out.data.buffer, out.data.byteOffset, w * h * 4);
  const W2 = w * 2;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : s[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = s[y * w + x];
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      const i = y * 2 * W2 + x * 2;
      o[i] = c === a && c !== d && a !== b ? a : p;
      o[i + 1] = a === b && a !== c && b !== d ? b : p;
      o[i + W2] = d === c && d !== b && c !== a ? c : p;
      o[i + W2 + 1] = b === d && b !== a && d !== c ? d : p;
    }
  }
  return out;
}
