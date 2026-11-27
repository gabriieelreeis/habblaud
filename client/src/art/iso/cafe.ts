// Móveis isométricos da copa, banheiro e recepção (puro). Convenções em ./kit.ts; a âncora é o canto de trás do footprint.
import type { FurnitureKind } from '../api';
import { ramp, type Ramp } from '../core/color';
import type { BufFurniture } from '../core/sprite';
import { ACCENTS, M, rngOf } from '../furniture/kit';
import { Iso, tone, type BoxMat, type Fill } from './kit';
import { SEAT_Z } from './office';

const COUNTER_Z = 18;
const TOP_Z = 20;
const GLOW = '#8fe3a4';

const CAB = ramp('#e4e1da', 0.05);
const STONE = ramp('#ece9e3', 0.035);

/** Tampo de pedra: veio leve; vai de borda a borda em x para emendar com o vizinho. */
function stoneTop(m: Ramp = STONE): BoxMat {
  return {
    top: (u, v, _w, h) => (v >= h - 1 ? m.hi : (u * 3 + Math.floor(v / 2) * 5) % 23 === 0 ? m.base : (u + v * 2) % 37 === 0 ? m.dk : m.lt),
    south: m.dk,
    east: m.dd,
  };
}

/** Gabinete: portas ou gavetas na face sul, rodapé escuro. */
function cabinetMat(drawers: boolean): BoxMat {
  const c = CAB;
  return {
    top: c.lt,
    east: (_u, v, _w, hh) => (v >= hh - 2 ? c.dd : c.dk),
    south: (u, v, w, hh) => {
      if (v >= hh - 2) return c.dd;
      if (u < 1 || u >= w - 1) return c.dk;
      if (drawers) {
        const band = (hh - 2) / 3;
        const k = Math.floor(v / band);
        const vv = v - k * band;
        if (vv < 1 && k > 0) return c.dk;
        if (Math.abs(u - w / 2) < 2.5 && vv > band / 2 - 1 && vv < band / 2 + 0.5) return M.steelDark.lt;
        return u < 1.5 ? c.lt : c.base;
      }
      if (Math.abs(u - w / 2) < 0.5) return c.dd;
      if (v < 1) return c.dk;
      if ((Math.abs(u - (w / 2 - 2)) < 0.75 || Math.abs(u - (w / 2 + 2)) < 0.75) && v > 2 && v < 7) return M.steelDark.base;
      return u < 1.5 ? c.lt : c.base;
    },
  };
}

function counterBody(s: Iso, drawers: boolean): void {
  s.shadow(0, 1, 16, 15, 0.2, 1);
  s.box(0, 2, 0, 16, 14, COUNTER_Z, cabinetMat(drawers));
  s.box(0, 1, COUNTER_Z, 16, 15, TOP_Z, stoneTop());
}

/** Fundo de chapa (eucatex) dos gabinetes vistos por trás. */
const HARDBOARD = ramp('#cbbb9c', 0.05);

/** Gabinete visto por trás: o fundo de chapa entre as laterais, a travessa, o rodapé e o tampo com a borda saliente. */
function cabinetBack(): BoxMat {
  const c = CAB;
  const hb = HARDBOARD;
  return {
    top: c.lt,
    east: (_u, v, _w, hh) => (v >= hh - 2 ? c.dd : c.dk),
    south: (u, v, w, hh) => {
      if (v >= hh - 2) return c.dd;
      if (v < 1) return hb.dd;
      if (u < 1 || u >= w - 1) return u < 1 ? c.base : c.dk;
      if (v < 3) return c.dk;
      if (Math.abs(u - w / 2) < 0.5) return hb.dk;
      return (Math.floor(u) * 7 + Math.floor(v) * 3) % 23 === 0 ? hb.dk : hb.base;
    },
  };
}

function counterBodyBack(s: Iso, top: BoxMat = stoneTop()): void {
  s.shadow(0, 1, 16, 15, 0.2, 1);
  s.box(0, 2, 0, 16, 14, COUNTER_Z, cabinetBack());
  s.box(0, 1, COUNTER_Z, 16, 15, TOP_Z, top);
}

const DARK_CORD = '#2b2f3a';

/** Cabo de força de um aparelho sobre a bancada, descendo por trás dela. */
function counterCord(s: Iso, x: number, y: number, z: number): void {
  s.line([x, y, z], [x, 15.4, TOP_Z + 0.5], DARK_CORD);
  s.line([x, 15.4, TOP_Z], [x, 15.4, 0.5], DARK_CORD);
}

function counter(variant: string | undefined): BufFurniture {
  const s = new Iso(1, 1, 36);
  counterBody(s, variant === 'drawers');
  return { base: s.finish() };
}

function counterBack(): BufFurniture {
  const s = new Iso(1, 1, 36);
  counterBodyBack(s);
  return { base: s.finish() };
}

/** Tampo com a cuba; `drain` = posição do ralo (u, v) no tampo. */
function sinkTop(drain: readonly [number, number]): BoxMat {
  const st = stoneTop();
  const stTop = st.top as (u: number, v: number, w: number, h: number) => string;
  return {
    ...st,
    top: (u, v, w, h) => {
      if (u >= 3 && u < 13 && v >= 3 && v < 11) {
        if (u >= drain[0] && u < drain[0] + 1.5 && v >= drain[1] && v < drain[1] + 1.5) return '#2a2f3a';
        return u < 4 || v < 4 ? M.steelDark.base : (u + v) % 6 < 1 ? M.steel.hi : M.steel.lt;
      }
      if (u >= 2.5 && u < 13.5 && v >= 2.5 && v < 11.5) return M.steelDark.dk;
      return stTop(u, v, w, h);
    },
  };
}

function counterSink(): BufFurniture {
  const s = new Iso(1, 1, 40);
  s.shadow(0, 1, 16, 15, 0.2, 1);
  s.box(0, 2, 0, 16, 14, COUNTER_Z, cabinetMat(false));
  s.box(0, 1, COUNTER_Z, 16, 15, TOP_Z, sinkTop([7.5, 6]));
  // torneira: coluna e bico
  s.box(7.5, 2.5, TOP_Z, 8.5, 3.5, TOP_Z + 7, M.steel);
  s.box(7.5, 3.5, TOP_Z + 6, 8.5, 6.5, TOP_Z + 7.5, M.steel);
  s.box(7.5, 5.5, TOP_Z + 4, 8.5, 6.5, TOP_Z + 6, M.steelDark);
  s.box(10.5, 2.5, TOP_Z, 11.5, 3.5, TOP_Z + 3, M.steelDark);
  return { base: s.finish() };
}

/** Bancada com pia vista por trás: a cuba no tampo e a torneira de costas, com o bico apontando para longe. */
function counterSinkBack(): BufFurniture {
  const s = new Iso(1, 1, 40);
  counterBodyBack(s, sinkTop([7, 6.5]));
  s.box(7.5, 9.5, TOP_Z + 4, 8.5, 10.5, TOP_Z + 6, M.steelDark);
  s.box(7.5, 9.5, TOP_Z + 6, 8.5, 12.5, TOP_Z + 7.5, M.steel);
  s.box(7.5, 12.5, TOP_Z, 8.5, 13.5, TOP_Z + 7, M.steel);
  s.box(4.5, 12.5, TOP_Z, 5.5, 13.5, TOP_Z + 3, M.steelDark);
  return { base: s.finish() };
}

function coffeeMachine(state: number): BufFurniture {
  const s = new Iso(1, 1, 52);
  counterBody(s, false);
  const z = TOP_Z;
  const g = M.graphite;
  // base, coluna de trás e cabeça
  s.box(2, 3, z, 14, 12, z + 2, g);
  s.box(2, 3, z + 2, 14, 7.5, z + 11, g);
  const head: BoxMat = {
    top: g.lt,
    east: g.dd,
    south: (u, v, _w, h) => {
      if (v < 1) return g.lt;
      if (u >= 2 && u < 6.5 && v >= 3 && v < 7) return state ? GLOW : '#3a4a52';
      if (u >= 8 && u < 10 && v >= 3.5 && v < 5.5) return state ? '#f2c14e' : '#6b5a3a';
      if (u >= 10.5 && u < 12 && v >= 3.5 && v < 5.5) return '#d85a5a';
      if (v >= h - 1) return g.dd;
      return u < 1 ? g.lt : g.base;
    },
  };
  s.box(2, 3, z + 11, 14, 11.5, z + 22, head);
  // bico e xícara
  s.box(7, 8.5, z + 8, 9, 10.5, z + 11, M.steelDark);
  s.box(6.5, 8.5, z + 10, 9.5, 10.5, z + 11, M.steel);
  s.cyl(8, 10, 2.6, z + 2, z + 7, tone('#f4f2ee', 0.07), (u, v) => (u * u + v * v < 0.5 ? (state ? '#6b4226' : '#2a2018') : '#f4f2ee'));
  if (state) {
    s.line([8, 10, z + 7], [8, 10, z + 10], '#6b4226', 1);
    s.px(9, 8.5, z + 25, 'rgba(255,255,255,0.7)');
    s.px(8, 8.5, z + 28, 'rgba(255,255,255,0.45)');
    s.px(9, 8.5, z + 31, 'rgba(255,255,255,0.3)');
  }
  return { base: s.finish() };
}

/** Cafeteira vista por trás: o reservatório de água translúcido na traseira, a ventilação e o cabo. */
function coffeeMachineBack(state: number): BufFurniture {
  const s = new Iso(1, 1, 52);
  counterBodyBack(s);
  const z = TOP_Z;
  const g = M.graphite;
  s.box(2, 4, z, 14, 13, z + 2, g);
  s.box(2, 8.5, z + 2, 14, 13, z + 11, { top: g.lt, east: g.dd, south: (u) => (u < 1 ? g.lt : g.dk) });
  s.box(2, 4.5, z + 11, 14, 13, z + 22, {
    top: g.lt,
    east: g.dd,
    south: (u, v, _w, h) => {
      if (v < 1) return g.lt;
      if (v >= h - 1) return g.dd;
      // grade de ventilação no alto
      if (u >= 1.5 && u < 10.5 && v >= 2 && v < 5) return Math.floor(u) % 2 === 0 ? g.dd : g.base;
      return u < 1 ? g.lt : g.base;
    },
  });
  // reservatório de água: caixa translúcida presa na traseira, com o nível da água
  const tank = (u: number, v: number, w: number, h: number): string => {
    if (u < 0.8 || u >= w - 0.8 || v < 0.8) return 'rgba(225,240,250,0.85)';
    return v < h * 0.35 ? 'rgba(200,225,240,0.55)' : v < h * 0.35 + 1 ? 'rgba(150,200,235,0.9)' : 'rgba(110,170,220,0.7)';
  };
  s.box(3, 13, z + 2, 9.5, 14.8, z + 18, { top: 'rgba(60,66,80,0.95)', south: tank, east: (_u, v, w, h) => tank(1, v, w, h) });
  counterCord(s, 12, 13.2, z + 3);
  if (state) {
    s.px(7, 7.5, z + 25, 'rgba(255,255,255,0.7)');
    s.px(8, 7.5, z + 28, 'rgba(255,255,255,0.45)');
    s.px(7, 7.5, z + 31, 'rgba(255,255,255,0.3)');
  }
  return { base: s.finish() };
}

function microwave(): BufFurniture {
  const s = new Iso(1, 1, 46);
  counterBody(s, false);
  const z = TOP_Z;
  const w = M.white;
  s.box(2, 3.5, z, 14, 11.5, z + 11, {
    top: w.hi,
    east: w.dk,
    south: (u, v, _wd, h) => {
      if (u < 1 || v < 1 || v >= h - 1) return w.lt;
      if (u >= 1.5 && u < 8.5 && v >= 1.5 && v < h - 1.5) return u < 2.5 || v < 2.5 ? '#6f7b8c' : '#2c3442';
      if (u >= 8.5 && u < 10.5) return w.dk;
      if (u >= 10.5 && u < 13.5 && v >= 2 && v < 4.5) return '#8fe3a4';
      if (u >= 10.5 && u < 13.5 && v >= 5.5 && v < 9) return (Math.floor(u) + Math.floor(v)) % 2 ? '#9aa0ab' : '#c3c8d0';
      return w.base;
    },
  });
  return { base: s.finish() };
}

/** Micro-ondas visto por trás: a chapa com os furos de ventilação, a etiqueta e o cabo. */
function microwaveBack(): BufFurniture {
  const s = new Iso(1, 1, 46);
  counterBodyBack(s);
  const z = TOP_Z;
  const w = M.white;
  s.box(2, 4.5, z, 14, 12.5, z + 11, {
    top: w.hi,
    east: (u, v, wd) => (u >= 2 && u < wd - 2 && v >= 2 && v < 4 && Math.floor(u) % 2 === 0 ? w.dd : w.dk),
    south: (u, v, wd, h) => {
      if (u < 1 || v < 1 || v >= h - 1) return w.lt;
      // furos de ventilação
      if (u >= 1.5 && u < 8.5 && v >= 2 && v < h - 2) return (Math.floor(u) + Math.floor(v)) % 2 === 0 ? w.dd : w.dk;
      // etiqueta
      if (u >= 9.5 && u < 12.5 && v >= 2 && v < 5) return v < 3 ? '#e9e9e4' : '#c9c9c3';
      return w.base;
    },
  });
  counterCord(s, 11.5, 12.7, z + 2);
  return { base: s.finish() };
}

function fridge(): BufFurniture {
  const s = new Iso(1, 1, 64);
  s.shadow(1, 2, 15, 15, 0.22, 1);
  const m = ramp('#d5dbe3', 0.05);
  s.box(1, 2, 0, 15, 14, 52, {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? m.hi : m.lt),
    east: (_u, v, _w, h) => (v >= h - 2 ? m.dd : m.dk),
    south: (u, v, w, h) => {
      if (v >= h - 2) return M.graphite.base;
      if (v < 1) return m.hi;
      if (u < 1) return m.hi;
      if (Math.abs(v - 16) < 0.6) return m.dd;
      if (u >= 10.5 && u < 12 && ((v >= 4 && v < 12) || (v >= 19 && v < 33))) return u < 11 ? M.steel.hi : M.steelDark.lt;
      if (u >= 3 && u < 6 && v >= 22 && v < 26) return '#e05a5a';
      if (u >= 5 && u < 8 && v >= 24 && v < 28) return '#f2c14e';
      return u > w - 2 ? m.base : v < 16 ? m.lt : m.base;
    },
  });
  return { base: s.finish() };
}

/** Grade preta do condensador (geladeira, bebedouro): tubos horizontais e aletas verticais. */
function coilFill(u: number, z: number, base: string): string {
  if (Math.floor(z) % 3 === 0) return DARK_CORD;
  return Math.floor(u) % 2 === 0 ? '#4b515e' : base;
}

/** Geladeira vista por trás: a grade do condensador, o compressor embaixo e o cabo. */
function fridgeBack(): BufFurniture {
  const s = new Iso(1, 1, 64);
  s.shadow(1, 1, 15, 14, 0.22, 1);
  const m = ramp('#d5dbe3', 0.05);
  s.box(1, 2, 0, 15, 14, 52, {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? m.hi : m.lt),
    east: (_u, v, _w, h) => (v >= h - 2 ? m.dd : m.dk),
    south: (u, v, w, h) => {
      const z = h - v;
      if (z < 2) return M.graphite.base;
      if (v < 1) return m.hi;
      if (u < 1 || u >= w - 1) return m.dk;
      // compressor
      if (u >= w - 6 && u < w - 1.5 && z >= 2.5 && z < 8) return z >= 7 ? M.graphite.lt : u < w - 5 ? M.graphite.base : M.graphite.dk;
      // grade do condensador
      if (u >= 2 && u < w - 2 && z >= 11 && z < 46) return z < 12 || z >= 45 ? m.dd : coilFill(u - 2, z - 11, m.dk);
      // etiqueta
      if (u >= 2 && u < 5.5 && z >= 3.5 && z < 7) return z >= 6 ? '#f4f2ea' : '#d6d6d0';
      return m.base;
    },
  });
  s.line([3.5, 14.2, 5], [3.5, 15.5, 0.5], DARK_CORD);
  return { base: s.finish() };
}

function vending(seed: number): BufFurniture {
  const s = new Iso(1, 1, 66);
  s.shadow(1, 2, 15, 15, 0.22, 1);
  const body = ramp('#c64a4a', 0.07);
  const r = rngOf(seed, 17);
  const rows: string[][] = [];
  for (let k = 0; k < 5; k++) {
    const row: string[] = [];
    for (let i = 0; i < 6; i++) row.push(r() < 0.1 ? '' : ACCENTS[Math.floor(r() * ACCENTS.length) % ACCENTS.length]);
    rows.push(row);
  }
  const south: Fill = (u, v, _w, h) => {
    if (v >= h - 2) return M.graphite.dk;
    if (u < 1 || v < 1) return body.hi;
    if (v < 4) return v < 3 ? '#f7e3a0' : body.dk;
    // vitrine iluminada
    if (u >= 1.5 && u < 10.5 && v >= 5 && v < 36) {
      if (u < 2 || v < 5.5 || v >= 35.5) return M.graphite.dk;
      const row = Math.floor((v - 6) / 6);
      const vv = (v - 6) % 6;
      if (row < 0 || row > 4) return '#fff3c4';
      if (vv >= 5) return '#9aa0ab';
      const col = rows[row][Math.floor((u - 2.5) / 1.5) % 6];
      if (col && vv >= 1.5 && (u - 2.5) % 1.5 < 1.2) return vv < 2.5 ? tone(col).hi : tone(col).base;
      return '#fff3c4';
    }
    // painel lateral: botões e moedeiro
    if (u >= 11.5 && u < 13.5) {
      if (v >= 6 && v < 14) return Math.floor(v) % 2 ? '#c3c8d0' : '#9aa0ab';
      if (v >= 17 && v < 21) return '#2a2f3a';
      if (v >= 24 && v < 26) return '#8fe3a4';
    }
    // gaveta de retirada
    if (u >= 2 && u < 10.5 && v >= 40 && v < 47) return v < 41 ? M.graphite.lt : '#232834';
    return body.base;
  };
  s.box(1, 2, 0, 15, 14, 54, { top: body.lt, south, east: (_u, v, _w, h) => (v >= h - 2 ? M.graphite.dd : body.dk) });
  return { base: s.finish() };
}

/** Máquina de lanches vista por trás: o letreiro aceso no alto, a porta de serviço, a grade de ventilação e o cabo. */
function vendingBack(): BufFurniture {
  const s = new Iso(1, 1, 66);
  s.shadow(1, 1, 15, 14, 0.22, 1);
  const body = ramp('#c64a4a', 0.07);
  const lit = (u: number, v: number): string => (v >= 1.5 && v < 3 && Math.floor(u) % 3 !== 2 ? '#e0a84a' : '#f7e3a0');
  s.box(1, 2, 0, 15, 14, 54, {
    top: body.lt,
    east: (u, v, _w, h) => (v >= h - 2 ? M.graphite.dd : v < 4 ? (v < 3.5 ? lit(u + 1, v) : body.dd) : body.dk),
    south: (u, v, w, h) => {
      const z = h - v;
      if (v >= h - 2) return M.graphite.dk;
      if (v < 4) return v < 3.5 && u >= 0.5 && u < w - 0.5 ? lit(u, v) : body.dk;
      if (u < 1 || u >= w - 1) return body.dk;
      // grade de ventilação embaixo
      if (u >= 2 && u < w - 2 && z >= 4 && z < 13) return Math.floor(z) % 2 === 0 ? '#2a2f3a' : body.dd;
      // porta de serviço: contorno, fechadura e etiqueta
      if (u >= 1.5 && u < w - 1.5 && z >= 15 && z < 47) {
        if (u < 2 || u >= w - 2 || z < 15.5 || z >= 46.5) return body.dd;
        if (u >= w - 4 && u < w - 3 && z >= 30 && z < 33) return M.steel.lt;
        if (u >= 3 && u < 7 && z >= 40 && z < 43) return z >= 42 ? '#f4f2ea' : '#d6d6d0';
        return body.base;
      }
      return body.base;
    },
  });
  s.line([12, 14.2, 6], [12, 15.5, 0.5], DARK_CORD);
  return { base: s.finish() };
}

function cafeTable(): BufFurniture {
  const s = new Iso(1, 1, 36);
  s.shadow(2, 2, 14, 14, 0.2, 0);
  s.cyl(8, 8, 4, 0, 1.5, M.graphite);
  s.cyl(8, 8, 1, 1, 15, M.steelDark);
  s.cyl(8, 8, 8, 15, 17, M.oak, (u, v) => (u * u + v * v > 0.8 ? M.oak.hi : M.oak.lt));
  return { base: s.finish() };
}

const CHAIR_SEATS = ['#3f62a3', '#b44a4a', '#3f8a62', '#d9a23c', '#8d66cf'] as const;

function cafeChair(variant: string | undefined, seed: number): BufFurniture {
  const c = ramp(CHAIR_SEATS[seed % CHAIR_SEATS.length], 0.07);
  const s = new Iso(1, 1, 36);
  const f = new Iso(1, 1, 36);
  s.shadow(3, 3, 13, 13, 0.2, 0);
  const dir = variant ?? 'down';
  const mat: BoxMat = { top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? c.hi : c.lt), south: c.base, east: c.dk };
  const back = (t: Iso, x0: number, y0: number, x1: number, y1: number): void => {
    t.box(x0, y0, SEAT_Z, x1, y1, SEAT_Z + 14, { top: c.hi, south: (u, v, _w, h) => (u < 1 || v < 1 ? c.lt : v >= h - 1 ? c.dk : c.base), east: c.dk });
  };
  // encosto ao norte/oeste: na base, antes do assento; ao sul/leste: no front
  if (dir === 'down') back(s, 3, 2.5, 13, 4.5);
  if (dir === 'right') back(s, 2.5, 3, 4.5, 13);
  for (const [x, y] of [
    [3, 3],
    [11.5, 3],
    [3, 11.5],
    [11.5, 11.5],
  ] as const)
    s.box(x, y, 0, x + 1.5, y + 1.5, SEAT_Z - 2, M.oakDark);
  s.box(3, 3, SEAT_Z - 2, 13, 13, SEAT_Z, mat);
  if (dir === 'up') back(f, 3, 11.5, 13, 13.5);
  if (dir === 'left') back(f, 11.5, 3, 13.5, 13);
  return dir === 'up' || dir === 'left' ? { base: s.finish(), front: f.finish() } : { base: s.finish() };
}

/** Tampo da pia com a cuba oval; `dy` desloca a cuba (px, para o lado da frente). */
function basinTop(dy: number): BoxMat {
  return {
    top: (u, v, w, h) => {
      const du = (u - w / 2) / 4.6;
      const dv = (v - h / 2 - dy) / 3.8;
      const d = du * du + dv * dv;
      if (d < 0.12) return '#2a2f3a';
      if (d < 0.8) return u + v < w / 2 + h / 2 ? M.steel.dk : M.steel.lt;
      if (d < 1) return M.steelDark.lt;
      return v >= h - 1 || u >= w - 1 ? M.white.hi : M.white.lt;
    },
    south: M.white.dk,
    east: M.white.dd,
  };
}

function sink(): BufFurniture {
  const s = new Iso(1, 1, 40);
  s.shadow(1, 2, 15, 14, 0.2, 1);
  s.box(2, 3, 0, 14, 13, 14, cabinetMat(false));
  s.box(1, 2, 14, 15, 14, 16, basinTop(0.5));
  s.box(7.5, 3.5, 16, 8.5, 4.5, 23, M.steel);
  s.box(7.5, 4.5, 22, 8.5, 7.5, 23, M.steel);
  s.box(7.5, 6.5, 20, 8.5, 7.5, 22, M.steelDark);
  s.box(11, 3.5, 16, 12, 4.5, 19, M.steelDark);
  return { base: s.finish() };
}

/** Pia vista por trás: a cuba no tampo, a torneira de costas e o sifão cromado saindo do gabinete para o chão. */
function sinkBack(): BufFurniture {
  const s = new Iso(1, 1, 40);
  s.shadow(1, 2, 15, 14, 0.2, 1);
  s.box(2, 3, 0, 14, 13, 14, cabinetBack());
  // sifão e flexíveis: saem do painel de trás e descem até o chão
  s.box(7.2, 13, 4, 8.8, 14.5, 9.5, M.steel);
  s.box(7.2, 14, 0, 8.8, 15.5, 5, M.steel);
  s.line([4.5, 13.2, 11], [4.5, 14.8, 0.5], M.steelDark.lt);
  s.line([11.5, 13.2, 11], [11.5, 14.8, 0.5], M.steelDark.lt);
  s.box(1, 2, 14, 15, 14, 16, basinTop(-0.5));
  s.box(7.5, 8.5, 20, 8.5, 9.5, 22, M.steelDark);
  s.box(7.5, 8.5, 22, 8.5, 11.5, 23, M.steel);
  s.box(7.5, 11.5, 16, 8.5, 12.5, 23, M.steel);
  s.box(4, 11.5, 16, 5, 12.5, 19, M.steelDark);
  return { base: s.finish() };
}

function receptionDesk(): BufFurniture {
  const s = new Iso(3, 1, 44);
  s.shadow(0, 1, 48, 16, 0.22, 1);
  const w = M.walnut;
  // prateleira de trabalho mais baixa, ao fundo
  s.box(0, 2, 0, 48, 9, 17, { top: w.lt, south: w.dk, east: w.dd });
  s.box(0, 2, 17, 48, 9, 18, { top: w.hi, south: w.base, east: w.dk });
  // balcão da frente, mais alto, com painel de madeira e friso claro
  s.box(0, 9, 0, 48, 15, 22, {
    top: w.base,
    east: w.dd,
    south: (u, v, wd, h) => {
      if (v >= h - 2) return w.dd;
      if (u < 1 || v < 1) return w.lt;
      if (u >= 6 && u < wd - 6 && v >= 4 && v < h - 5) {
        if (u < 7 || u >= wd - 7 || v < 5 || v >= h - 6) return M.oak.base;
        return Math.floor(u / 3) % 2 ? w.base : w.dk;
      }
      return u % 12 < 1 ? w.dk : w.base;
    },
  });
  s.box(-1, 8.5, 22, 49, 16.5, 24, {
    top: (u, v, _wd, h) => (v >= h - 1 ? STONE.hi : (u * 3 + Math.floor(v / 2) * 5) % 29 === 0 ? STONE.base : STONE.lt),
    south: STONE.dk,
    east: STONE.dd,
  });
  // sino e porta-canetas
  s.cyl(38, 12.5, 2.2, 24, 25.5, M.steel);
  s.box(8, 11, 24, 12, 14, 29, M.graphite);
  s.line([9, 12, 29], [10, 12.5, 32], '#d85a5a');
  s.line([10, 12, 29], [11, 12.5, 31], '#3f7fd8');
  return { base: s.finish() };
}

/** Topo do assento do banco (px). */
export const BENCH_TOP = SEAT_Z + 2;

/** Banco de espera 2x1 (cada tile é um lugar), olhando para o sul: encosto ao norte, tudo na base. */
function bench(): BufFurniture {
  const s = new Iso(2, 1, 40);
  s.shadow(1, 2, 31, 14, 0.2, 1);
  const c = ramp('#4f78b8', 0.07);
  // encosto ao norte, atrás
  s.box(1, 2.5, 8, 31, 4.5, 20, { top: c.hi, south: (u, v, _w, h) => (u < 1 || v < 1 ? c.lt : v >= h - 1 ? c.dk : c.base), east: c.dk });
  for (const x of [3, 28]) s.box(x, 3, 0, x + 1.5, 13, SEAT_Z - 1, M.graphite);
  s.box(1, 3, BENCH_TOP - 4, 31, 13, BENCH_TOP, {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? c.hi : u % 15 < 1 ? c.base : c.lt),
    south: (u, v) => (v < 1 ? c.lt : u % 15 < 1 ? c.dk : c.base),
    east: c.dk,
  });
  return { base: s.finish() };
}

/** Medidas da cabine: divisórias a partir de Z0, altas atrás (H) e mais baixas na frente (FH); porta de DX0 a DX1. */
const STALL = { Z0: 4, H: 50, FH: 42, DX0: 8, DX1: 24 } as const;
const STALL_WALL = ramp('#cfd8e0', 0.05);
const STALL_DOOR = ramp('#c4b393', 0.05);

function stallWall(): BoxMat {
  const p = STALL_WALL;
  return {
    top: p.hi,
    south: (u, v, _w, h) => (v >= h - 1 ? p.dd : u < 1 || v < 1 ? p.lt : p.base),
    east: (_u, v) => (v < 1 ? p.base : p.dk),
  };
}

/** Cabine vista por trás (porta ao norte): as divisórias altas com a borda de cima e, por cima delas, o alto da porta. */
function toiletStallBack(): BufFurniture {
  const s = new Iso(2, 2, 70);
  const f = new Iso(2, 2, 70);
  const { Z0, H, FH, DX0, DX1 } = STALL;
  const p = STALL_WALL;
  const wall = stallWall();
  s.shadow(0, 0, 32, 32, 0.2, 1);
  // a parede da porta (agora ao norte) e a lateral oeste, mais baixas
  s.box(0, 0, Z0, 2, 32, FH, wall);
  s.box(2, 0, Z0, 32 - DX1, 2, FH, wall);
  s.box(32 - DX0, 0, Z0, 32, 2, FH, wall);
  const door = STALL_DOOR;
  s.box(32 - DX1, 0.2, Z0, 32 - DX0, 1.8, FH - 2, { top: door.hi, east: door.dk, south: (u, v, w) => (u < 1 || v < 1 || u >= w - 1 ? door.lt : door.base) });
  // as divisórias altas de trás, na frente da câmera: painéis com emenda e a borda de cima
  const panel: BoxMat = {
    top: p.hi,
    south: (u, v, w, h) => (v >= h - 1 ? p.dd : v < 1 ? p.lt : u < 1 ? p.lt : Math.abs(u - w / 2) < 0.5 ? p.dk : p.base),
    east: (u, v, w) => (v < 1 ? p.base : Math.abs(u - w / 2) < 0.5 ? p.dd : p.dk),
  };
  f.box(30, 0, Z0, 32, 30, H, panel);
  f.box(0, 30, Z0, 32, 32, H, panel);
  return { base: s.finish(), front: f.finish() };
}

function toiletStall(state: number): BufFurniture {
  const s = new Iso(2, 2, 70);
  const f = new Iso(2, 2, 70);
  s.shadow(0, 0, 32, 32, 0.2, 1);
  const { Z0, H, FH } = STALL;
  const wall = stallWall();
  // fundo (norte) e lateral oeste: base
  s.box(0, 0, Z0, 32, 2, H, wall);
  s.box(0, 2, Z0, 2, 32, H, wall);
  // vaso
  const por = M.ceramic;
  s.box(5, 3, 0, 15, 5, 22, por);
  s.box(6, 2.5, 22, 14, 5.5, 23.5, { top: M.steel.lt, south: M.steel.base, east: M.steel.dk });
  s.cyl(10, 11, 4.5, 0, 6, por, por.hi);
  s.box(5.5, 5, 6, 14.5, 16, 10, { top: por.hi, south: por.base, east: por.dk });
  s.disc(10, 11, 3.6, 10.2, (u, v) => (u * u + v * v > 0.45 ? por.hi : '#78a7c8'));
  // frente: parede leste e parede sul com a porta, sempre fechada; só o indicador da tranca muda (verde livre, vermelho ocupada)
  const { DX0, DX1 } = STALL;
  f.box(30, 0, Z0, 32, 32, FH, wall);
  f.box(0, 30, Z0, DX0, 32, FH, wall);
  f.box(DX1, 30, Z0, 30, 32, FH, wall);
  const door = STALL_DOOR;
  const lamp = state ? ['#ef6a6a', '#b23a3a'] : ['#6fd08c', '#2f8f52'];
  f.box(DX0, 30.2, Z0, DX1, 31.8, FH - 2, {
    top: door.hi,
    east: door.dk,
    south: (u, v, w) => {
      if (u < 1 || v < 1 || u >= w - 1) return door.lt;
      if (u >= w - 5 && u < w - 2 && v >= 19 && v < 23) return u < w - 3 ? lamp[0] : lamp[1];
      if (v >= 6 && v < 9 && u > 3 && u < w - 3) return door.dk;
      return door.base;
    },
  });
  return { base: s.finish(), front: f.finish() };
}

/** Desenho isométrico de um kind deste grupo, ou null se o kind não é daqui. */
export function cafeKinds(kind: FurnitureKind, variant: string | undefined, state: number, seed: number): BufFurniture | null {
  switch (kind) {
    case 'counter':
      return counter(variant);
    case 'counter_sink':
      return counterSink();
    case 'coffee_machine':
      return coffeeMachine(state);
    case 'microwave':
      return microwave();
    case 'fridge':
      return fridge();
    case 'vending_machine':
      return vending(seed);
    case 'cafe_table':
      return cafeTable();
    case 'cafe_chair':
      return cafeChair(variant, seed);
    case 'toilet_stall':
      return toiletStall(state);
    case 'sink':
      return sink();
    case 'reception_desk':
      return receptionDesk();
    case 'bench':
      return bench();
    default:
      return null;
  }
}

/** Costas (o móvel de frente para o norte) de um kind deste grupo, ou null. */
export function cafeBack(kind: FurnitureKind, state: number): BufFurniture | null {
  switch (kind) {
    case 'counter':
      return counterBack();
    case 'counter_sink':
      return counterSinkBack();
    case 'coffee_machine':
      return coffeeMachineBack(state);
    case 'microwave':
      return microwaveBack();
    case 'fridge':
      return fridgeBack();
    case 'vending_machine':
      return vendingBack();
    case 'sink':
      return sinkBack();
    case 'toilet_stall':
      return toiletStallBack();
    default:
      return null;
  }
}
