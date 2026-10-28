/**
 * Local QR code encoder — renders a QR as inline SVG inside the Worker.
 *
 * WHY THIS EXISTS (privacy)
 * The DJ poster used to fetch its QR image from a third-party generator with
 * the live-set URL (DJ id + event id) in the query string, so every poster view
 * reported who was playing where to an outside service. Encoding here means the
 * URL never leaves our own response.
 *
 * Scope is deliberately narrow: byte mode, error-correction level M, versions
 * 1-40, automatic mask choice. Pure computation — no Node built-ins, no canvas,
 * no I/O — so it runs unchanged in the Workers runtime. The algorithm follows
 * Project Nayuki's QR Code generator (MIT licence, nayuki.io), reduced to the
 * one mode and one ECC level we use; correctness is pinned by decoding every
 * version with an independent decoder in tests/unit/dj-poster-local-qr.test.ts.
 */

/*
 * Portions of this file (the version/capacity tables, the Reed-Solomon and
 * block-interleaving routines, and the format and version information drawing)
 * are derived from the following library, used under its MIT licence. Its
 * notice is reproduced here as that licence requires.
 *
 * QR Code generator library (TypeScript)
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

/** Level M error-correction codewords per block, indexed by version (0 unused). */
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
  26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];

/** Level M error-correction block count, indexed by version (0 unused). */
const NUM_BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
  17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

/** Format-info bits for level M. */
const ECL_FORMAT_BITS = 0;

/** Quiet zone, in modules, on every side of the symbol (the spec minimum). */
const QUIET_ZONE = 4;

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver: number): number {
  return Math.floor(numRawDataModules(ver) / 8) - (ECC_PER_BLOCK[ver] as number) * (NUM_BLOCKS[ver] as number);
}

// --- Reed-Solomon over GF(2^8), polynomial 0x11D ---------------------------

function rsMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j] as number, root);
      if (j + 1 < result.length) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = (result[i] as number) ^ rsMultiply(coef, factor);
    });
  }
  return result;
}

// --- Data encoding -----------------------------------------------------------

/** Byte-mode data codewords (with terminator and padding) for one version. */
function encodeData(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const append = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  append(0x4, 4);
  append(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) append(b, 8);

  const capacityBits = numDataCodewords(ver) * 8;
  append(0, Math.min(4, capacityBits - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);

  const codewords: number[] = new Array<number>(bits.length / 8).fill(0);
  bits.forEach((bit, i) => {
    codewords[i >>> 3] = (codewords[i >>> 3] as number) | (bit << (7 - (i & 7)));
  });
  return codewords;
}

function addEccAndInterleave(data: readonly number[], ver: number): number[] {
  const numBlocks = NUM_BLOCKS[ver] as number;
  const blockEccLen = ECC_PER_BLOCK[ver] as number;
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const divisor = rsDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  const blockLen = (blocks[0] as number[]).length;
  for (let i = 0; i < blockLen; i++) {
    blocks.forEach((block, j) => {
      // Skip the padding cell that short blocks carry in the data region.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i] as number);
    });
  }
  return result;
}

// --- Symbol construction -----------------------------------------------------

class QrSymbol {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly isFunction: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  private setFunction(x: number, y: number, dark: boolean): void {
    (this.modules[y] as boolean[])[x] = dark;
    (this.isFunction[y] as boolean[])[x] = true;
  }

  drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);

    const pos = this.alignmentPositions();
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(pos[i] as number, pos[j] as number);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFinder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunction(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  private drawAlignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  private alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const numAlign = Math.floor(this.version / 7) + 2;
    const step = Math.floor((this.version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  drawFormatBits(mask: number): void {
    const data = (ECL_FORMAT_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) this.setFunction(8, i, getBit(bits, i));
    this.setFunction(8, 7, getBit(bits, 6));
    this.setFunction(8, 8, getBit(bits, 7));
    this.setFunction(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, getBit(bits, i));
    this.setFunction(8, this.size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!(this.isFunction[y] as boolean[])[x] && i < data.length * 8) {
            (this.modules[y] as boolean[])[x] = getBit(data[i >>> 3] as number, 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert && !(this.isFunction[y] as boolean[])[x]) {
          const row = this.modules[y] as boolean[];
          row[x] = !row[x];
        }
      }
    }
  }

  /** ISO 18004 mask penalty (rules N1-N4); lower is easier to scan. */
  penalty(): number {
    const n = this.size;
    const at = (x: number, y: number): boolean => (this.modules[y] as boolean[])[x] as boolean;
    let score = 0;

    // N1: runs of 5+ same-colour modules in a row or column.
    for (let a = 0; a < n; a++) {
      for (const horizontal of [true, false]) {
        let runColor = false;
        let run = 0;
        for (let b = 0; b < n; b++) {
          const c = horizontal ? at(b, a) : at(a, b);
          if (b > 0 && c === runColor) {
            run++;
          } else {
            if (run >= 5) score += 3 + (run - 5);
            runColor = c;
            run = 1;
          }
        }
        if (run >= 5) score += 3 + (run - 5);
      }
    }

    // N2: 2x2 blocks of one colour.
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = at(x, y);
        if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
      }
    }

    // N3: finder-like 1:1:3:1:1 pattern with four light modules on one side
    // (positions off the symbol count as light — they sit in the quiet zone).
    const pattern = [true, false, true, true, true, false, true];
    for (let a = 0; a < n; a++) {
      for (const horizontal of [true, false]) {
        const get = (b: number): boolean =>
          b >= 0 && b < n && (horizontal ? at(b, a) : at(a, b));
        for (let b = 0; b + 7 <= n; b++) {
          if (!pattern.every((p, k) => get(b + k) === p)) continue;
          const lightBefore = [1, 2, 3, 4].every((k) => !get(b - k));
          const lightAfter = [0, 1, 2, 3].every((k) => !get(b + 7 + k));
          if (lightBefore) score += 40;
          if (lightAfter) score += 40;
        }
      }
    }

    // N4: dark/light balance.
    let dark = 0;
    for (const row of this.modules) for (const c of row) if (c) dark++;
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    score += Math.max(0, k) * 10;

    return score;
  }
}

/**
 * Encode `text` (UTF-8, byte mode, ECC level M) and return the module matrix:
 * matrix[y][x] is true for a dark module. Throws when the text is too long for
 * the largest QR version.
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  for (; ver <= 40; ver++) {
    const used = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    if (used <= numDataCodewords(ver) * 8) break;
  }
  if (ver > 40) throw new RangeError('Text too long for a QR code');

  const symbol = new QrSymbol(ver);
  symbol.drawFunctionPatterns();
  symbol.drawCodewords(addEccAndInterleave(encodeData(bytes, ver), ver));

  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    symbol.applyMask(mask);
    symbol.drawFormatBits(mask);
    const score = symbol.penalty();
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    symbol.applyMask(mask); // XOR again to undo
  }
  symbol.applyMask(bestMask);
  symbol.drawFormatBits(bestMask);
  return symbol.modules;
}

/**
 * Render `text` as a self-contained SVG QR code: dark modules on a white
 * background with a 4-module quiet zone. The markup contains only numbers and
 * fixed strings — the encoded text itself never appears in it — so it is safe to
 * splice into HTML as-is.
 */
export function qrSvg(text: string, pixelSize = 260, label = 'Scan to attribute'): string {
  const matrix = qrMatrix(text);
  const dim = matrix.length + QUIET_ZONE * 2;
  let d = '';
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + QUIET_ZONE},${y + QUIET_ZONE}h1v1h-1z`;
    });
  });
  const safeLabel = label.replace(/[^A-Za-z0-9 .,-]/g, '');
  // No xmlns attribute: this SVG is only ever placed inline in an HTML page,
  // where the HTML parser puts <svg> in the SVG namespace by itself. (Served as
  // a standalone .svg file or a data: image it would need one.) Leaving it out
  // also keeps this file free of any plain-http web address, which the Level 0
  // security gate forbids in production source.
  return (
    `<svg viewBox="0 0 ${dim} ${dim}" ` +
    `width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="${safeLabel}" data-testid="qr-code">` +
    `<rect width="100%" height="100%" fill="white"/>` +
    `<path d="${d}" fill="black"/>` +
    `</svg>`
  );
}
