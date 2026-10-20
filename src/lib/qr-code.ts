/**
 * Pure ISO/IEC 18004 QR Code Matrix Generator (Byte Mode, ECC Level L/M).
 * Generates a scannable 2D boolean matrix for cryptocurrency deposit addresses
 * and URLs with zero external dependencies or network requests.
 */

// Total data codewords & ECC codewords per block for ECC Level L, Versions 1..10
const VERSION_SPEC: Record<
  number,
  {
    totalDataCodewords: number;
    ecCodewordsPerBlock: number;
    numBlocksGroup1: number;
    dataCodewordsGroup1: number;
    numBlocksGroup2: number;
    dataCodewordsGroup2: number;
    alignmentCenters: number[];
  }
> = {
  1: {
    totalDataCodewords: 19,
    ecCodewordsPerBlock: 7,
    numBlocksGroup1: 1,
    dataCodewordsGroup1: 19,
    numBlocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignmentCenters: [],
  },
  2: {
    totalDataCodewords: 34,
    ecCodewordsPerBlock: 10,
    numBlocksGroup1: 1,
    dataCodewordsGroup1: 34,
    numBlocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignmentCenters: [6, 18],
  },
  3: {
    totalDataCodewords: 55,
    ecCodewordsPerBlock: 15,
    numBlocksGroup1: 1,
    dataCodewordsGroup1: 55,
    numBlocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignmentCenters: [6, 22],
  },
  4: {
    totalDataCodewords: 80,
    ecCodewordsPerBlock: 20,
    numBlocksGroup1: 1,
    dataCodewordsGroup1: 80,
    numBlocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignmentCenters: [6, 26],
  },
  5: {
    totalDataCodewords: 108,
    ecCodewordsPerBlock: 26,
    numBlocksGroup1: 1,
    dataCodewordsGroup1: 108,
    numBlocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignmentCenters: [6, 30],
  },
  6: {
    totalDataCodewords: 136,
    ecCodewordsPerBlock: 18,
    numBlocksGroup1: 2,
    dataCodewordsGroup1: 68,
    numBlocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignmentCenters: [6, 34],
  },
  7: {
    totalDataCodewords: 156,
    ecCodewordsPerBlock: 20,
    numBlocksGroup1: 2,
    dataCodewordsGroup1: 78,
    numBlocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignmentCenters: [6, 22, 38],
  },
  8: {
    totalDataCodewords: 194,
    ecCodewordsPerBlock: 24,
    numBlocksGroup1: 2,
    dataCodewordsGroup1: 97,
    numBlocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignmentCenters: [6, 24, 42],
  },
  9: {
    totalDataCodewords: 232,
    ecCodewordsPerBlock: 30,
    numBlocksGroup1: 2,
    dataCodewordsGroup1: 116,
    numBlocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignmentCenters: [6, 26, 46],
  },
  10: {
    totalDataCodewords: 274,
    ecCodewordsPerBlock: 18,
    numBlocksGroup1: 2,
    dataCodewordsGroup1: 68,
    numBlocksGroup2: 2,
    dataCodewordsGroup2: 69,
    alignmentCenters: [6, 28, 50],
  },
};

function gfMul(x: number, y: number): number {
  let r = 0;
  for (let i = 7; i >= 0; i--) {
    r = (r << 1) ^ ((r >>> 7) * 0x11d);
    r ^= ((y >>> i) & 1) * x;
  }
  return r;
}

function rsDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[divisor.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= gfMul(divisor[i], factor);
    }
  }
  return result;
}

function pickVersion(byteLength: number): number {
  for (let v = 1; v <= 10; v++) {
    const spec = VERSION_SPEC[v];
    // Byte mode header: 4 bits mode + (8 bits count for v<=9, 16 bits for v>=10)
    const headerBits = v <= 9 ? 12 : 20;
    const capacityBytes = Math.floor((spec.totalDataCodewords * 8 - headerBits) / 8);
    if (byteLength <= capacityBytes) return v;
  }
  return 10;
}

function encodeDataCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const spec = VERSION_SPEC[version];
  const bits: number[] = [];

  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  }

  // Mode indicator for Byte mode: 0100
  pushBits(0b0100, 4);
  // Character count indicator
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  // Payload bytes
  for (const b of bytes) {
    pushBits(b, 8);
  }

  // Terminator (up to 4 zero bits)
  const capacityBits = spec.totalDataCodewords * 8;
  const termLen = Math.min(4, capacityBits - bits.length);
  pushBits(0, termLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Pad bytes (0xEC, 0x11 alternating)
  let padToggle = 0;
  while (bits.length < capacityBits) {
    pushBits(padToggle % 2 === 0 ? 0xec : 0x11, 8);
    padToggle++;
  }

  const dataCodewords = new Uint8Array(spec.totalDataCodewords);
  for (let i = 0; i < dataCodewords.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i * 8 + j];
    }
    dataCodewords[i] = byte;
  }
  return dataCodewords;
}

function interleaveWithEcc(dataCodewords: Uint8Array, version: number): Uint8Array {
  const spec = VERSION_SPEC[version];
  const divisor = rsDivisor(spec.ecCodewordsPerBlock);

  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < spec.numBlocksGroup1; i++) {
    const block = dataCodewords.subarray(offset, offset + spec.dataCodewordsGroup1);
    offset += spec.dataCodewordsGroup1;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, divisor));
  }
  for (let i = 0; i < spec.numBlocksGroup2; i++) {
    const block = dataCodewords.subarray(offset, offset + spec.dataCodewordsGroup2);
    offset += spec.dataCodewordsGroup2;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, divisor));
  }

  const result: number[] = [];
  const maxDataLen = Math.max(spec.dataCodewordsGroup1, spec.dataCodewordsGroup2);
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (const block of eccBlocks) {
      result.push(block[i]);
    }
  }

  return new Uint8Array(result);
}

export function generateQrMatrix(value: string): boolean[][] {
  const rawBytes = new TextEncoder().encode(value || " ");
  const version = pickVersion(rawBytes.length);
  const bytes =
    rawBytes.length > VERSION_SPEC[10].totalDataCodewords - 3
      ? rawBytes.subarray(0, VERSION_SPEC[10].totalDataCodewords - 3)
      : rawBytes;

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );

  function setFunctionModule(r: number, c: number, dark: boolean) {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = dark;
    isFunction[r][c] = true;
  }

  function drawFinderPattern(centerR: number, centerC: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const r = centerR + dy;
        const c = centerC + dx;
        if (r >= 0 && r < size && c >= 0 && c < size) {
          setFunctionModule(r, c, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  function drawAlignmentPattern(centerR: number, centerC: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setFunctionModule(
          centerR + dy,
          centerC + dx,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
        );
      }
    }
  }

  // 1. Finder patterns
  drawFinderPattern(3, 3);
  drawFinderPattern(3, size - 4);
  drawFinderPattern(size - 4, 3);

  // 2. Timing patterns
  for (let i = 0; i < size; i++) {
    if (!isFunction[6][i]) setFunctionModule(6, i, i % 2 === 0);
    if (!isFunction[i][6]) setFunctionModule(i, 6, i % 2 === 0);
  }

  // 3. Alignment patterns
  const centers = VERSION_SPEC[version].alignmentCenters;
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === centers.length - 1) ||
        (i === centers.length - 1 && j === 0)
      ) {
        continue;
      }
      drawAlignmentPattern(centers[i], centers[j]);
    }
  }

  // 4. Reserve format info bits & dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunctionModule(8, i, false);
      setFunctionModule(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunctionModule(8, size - 1 - i, false);
    setFunctionModule(size - 1 - i, 8, false);
  }
  setFunctionModule(size - 8, 8, true); // Always dark module

  // 5. Place data + ECC bits in zig-zag order
  const dataCw = encodeDataCodewords(bytes, version);
  const allCw = interleaveWithEcc(dataCw, version);

  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunction[r][c] && bitIdx < allCw.length * 8) {
          const dark = ((allCw[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
          modules[r][c] = dark;
          bitIdx++;
        }
      }
    }
  }

  // 6. Apply Mask 0 ((r + c) % 2 === 0) and write Format Information for ECC Level L (01), Mask 0 (000)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunction[r][c] && (r + c) % 2 === 0) {
        modules[r][c] = !modules[r][c];
      }
    }
  }

  // Format bits for ECC Level L (01) and Mask 0 (000): BCH encoded & XORed with 0x5412 = 0x77c4
  const formatBits = 0x77c4;
  const getBit = (val: number, i: number) => ((val >>> i) & 1) !== 0;

  // Copy 1 around top-left finder
  for (let i = 0; i <= 5; i++) setFunctionModule(i, 8, getBit(formatBits, i));
  setFunctionModule(7, 8, getBit(formatBits, 6));
  setFunctionModule(8, 8, getBit(formatBits, 7));
  setFunctionModule(8, 7, getBit(formatBits, 8));
  for (let i = 9; i < 15; i++) setFunctionModule(8, 14 - i, getBit(formatBits, i));

  // Copy 2 along top-right & bottom-left
  for (let i = 0; i < 8; i++) setFunctionModule(8, size - 1 - i, getBit(formatBits, i));
  for (let i = 8; i < 15; i++) setFunctionModule(size - 15 + i, 8, getBit(formatBits, i));
  setFunctionModule(size - 8, 8, true);

  return modules;
}
