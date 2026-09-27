"use client";

const ALIGNMENT_CENTERS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50]
};

type RsBlock = {
  count: number;
  total: number;
  data: number;
};

const RS_BLOCKS_L: Record<number, RsBlock[]> = {
  1: [{ count: 1, total: 26, data: 19 }],
  2: [{ count: 1, total: 44, data: 34 }],
  3: [{ count: 1, total: 70, data: 55 }],
  4: [{ count: 1, total: 100, data: 80 }],
  5: [{ count: 1, total: 134, data: 108 }],
  6: [{ count: 2, total: 86, data: 68 }],
  7: [{ count: 2, total: 98, data: 78 }],
  8: [{ count: 2, total: 121, data: 97 }],
  9: [{ count: 2, total: 146, data: 116 }],
  10: [
    { count: 2, total: 86, data: 68 },
    { count: 2, total: 87, data: 69 }
  ]
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

{
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if ((value & 0x100) !== 0) value ^= 0x11d;
  }
  for (let index = 255; index < GF_EXP.length; index += 1) {
    GF_EXP[index] = GF_EXP[index - 255]!;
  }
}

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return GF_EXP[GF_LOG[left]! + GF_LOG[right]!]!;
}

function appendBits(target: number[], value: number, length: number): void {
  for (let bit = length - 1; bit >= 0; bit -= 1) {
    target.push((value >>> bit) & 1);
  }
}

function dataCodewords(version: number): number {
  return RS_BLOCKS_L[version]!.reduce(
    (sum, block) => sum + block.count * block.data,
    0
  );
}

function selectVersion(byteLength: number): number {
  for (let version = 1; version <= 10; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    const requiredBits = 4 + countBits + byteLength * 8;
    if (requiredBits <= dataCodewords(version) * 8) return version;
  }
  throw new Error("TOTP provisioning URI is too long for the local QR renderer.");
}

function makeDataBytes(value: string, version: number): number[] {
  const bytes = Array.from(new TextEncoder().encode(value));
  const capacityBits = dataCodewords(version) * 8;
  const countBits = version <= 9 ? 8 : 16;
  const bits: number[] = [];

  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, countBits);
  for (const byte of bytes) appendBits(bits, byte, 8);

  const terminator = Math.min(4, capacityBits - bits.length);
  appendBits(bits, 0, Math.max(0, terminator));
  while (bits.length % 8 !== 0) bits.push(0);

  const result: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) {
      byte = (byte << 1) | bits[index + offset]!;
    }
    result.push(byte);
  }

  let padIndex = 0;
  while (result.length < dataCodewords(version)) {
    result.push(padIndex % 2 === 0 ? 0xec : 0x11);
    padIndex += 1;
  }
  return result;
}

function rsGenerator(degree: number): number[] {
  let polynomial = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array(polynomial.length + 1).fill(0) as number[];
    const root = GF_EXP[index]!;
    for (let coefficient = 0; coefficient < polynomial.length; coefficient += 1) {
      next[coefficient] ^= polynomial[coefficient]!;
      next[coefficient + 1] ^=
        gfMultiply(polynomial[coefficient]!, root);
    }
    polynomial = next;
  }
  return polynomial.slice(1);
}

function rsRemainder(data: readonly number[], degree: number): number[] {
  const generator = rsGenerator(degree);
  const remainder = new Array(degree).fill(0) as number[];

  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);
    for (let index = 0; index < degree; index += 1) {
      remainder[index] ^= gfMultiply(generator[index]!, factor);
    }
  }
  return remainder;
}

function interleavedCodewords(value: string, version: number): number[] {
  const data = makeDataBytes(value, version);
  const blocks: Array<{ data: number[]; ecc: number[] }> = [];
  let offset = 0;

  for (const spec of RS_BLOCKS_L[version]!) {
    const eccLength = spec.total - spec.data;
    for (let index = 0; index < spec.count; index += 1) {
      const blockData = data.slice(offset, offset + spec.data);
      offset += spec.data;
      blocks.push({
        data: blockData,
        ecc: rsRemainder(blockData, eccLength)
      });
    }
  }

  const output: number[] = [];
  const maxDataLength = Math.max(...blocks.map((block) => block.data.length));
  for (let index = 0; index < maxDataLength; index += 1) {
    for (const block of blocks) {
      if (index < block.data.length) output.push(block.data[index]!);
    }
  }

  const maxEccLength = Math.max(...blocks.map((block) => block.ecc.length));
  for (let index = 0; index < maxEccLength; index += 1) {
    for (const block of blocks) {
      if (index < block.ecc.length) output.push(block.ecc[index]!);
    }
  }

  return output;
}

function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask; // L error correction level.
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function versionBits(version: number): number {
  let remainder = version;
  for (let index = 0; index < 12; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }
  return (version << 12) | remainder;
}

function qrMatrix(value: string): boolean[][] {
  const bytes = new TextEncoder().encode(value);
  const version = selectVersion(bytes.length);
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false)
  );
  const functions = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false)
  );

  const setFunction = (row: number, column: number, dark: boolean) => {
    if (row < 0 || column < 0 || row >= size || column >= size) return;
    modules[row]![column] = dark;
    functions[row]![column] = true;
  };

  const drawFinder = (centerRow: number, centerColumn: number) => {
    for (let rowOffset = -4; rowOffset <= 4; rowOffset += 1) {
      for (let columnOffset = -4; columnOffset <= 4; columnOffset += 1) {
        const distance = Math.max(
          Math.abs(rowOffset),
          Math.abs(columnOffset)
        );
        setFunction(
          centerRow + rowOffset,
          centerColumn + columnOffset,
          distance === 3 || distance <= 1
        );
      }
    }
  };

  drawFinder(3, 3);
  drawFinder(3, size - 4);
  drawFinder(size - 4, 3);

  for (let index = 0; index < size; index += 1) {
    if (!functions[6]![index]) {
      setFunction(6, index, index % 2 === 0);
    }
    if (!functions[index]![6]) {
      setFunction(index, 6, index % 2 === 0);
    }
  }

  for (const centerRow of ALIGNMENT_CENTERS[version]!) {
    for (const centerColumn of ALIGNMENT_CENTERS[version]!) {
      if (functions[centerRow]![centerColumn]) continue;
      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
          const distance = Math.max(
            Math.abs(rowOffset),
            Math.abs(columnOffset)
          );
          setFunction(
            centerRow + rowOffset,
            centerColumn + columnOffset,
            distance !== 1
          );
        }
      }
    }
  }

  const mask = 0;
  const format = formatBits(mask);
  for (let index = 0; index <= 5; index += 1) {
    setFunction(index, 8, ((format >>> index) & 1) !== 0);
  }
  setFunction(7, 8, ((format >>> 6) & 1) !== 0);
  setFunction(8, 8, ((format >>> 7) & 1) !== 0);
  setFunction(8, 7, ((format >>> 8) & 1) !== 0);
  for (let index = 9; index < 15; index += 1) {
    setFunction(8, 14 - index, ((format >>> index) & 1) !== 0);
  }
  for (let index = 0; index < 8; index += 1) {
    setFunction(8, size - 1 - index, ((format >>> index) & 1) !== 0);
  }
  for (let index = 8; index < 15; index += 1) {
    setFunction(
      size - 15 + index,
      8,
      ((format >>> index) & 1) !== 0
    );
  }
  setFunction(size - 8, 8, true);

  if (version >= 7) {
    const encodedVersion = versionBits(version);
    for (let index = 0; index < 18; index += 1) {
      const dark = ((encodedVersion >>> index) & 1) !== 0;
      const first = size - 11 + (index % 3);
      const second = Math.floor(index / 3);
      setFunction(second, first, dark);
      setFunction(first, second, dark);
    }
  }

  const codewords = interleavedCodewords(value, version);
  const dataBits: number[] = [];
  for (const codeword of codewords) appendBits(dataBits, codeword, 8);

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;

    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        if (functions[row]![column]) continue;

        let dark = bitIndex < dataBits.length
          ? dataBits[bitIndex]! === 1
          : false;
        if ((row + column) % 2 === 0) dark = !dark;
        modules[row]![column] = dark;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  return modules;
}

export function TotpQrCode({
  value,
  size = 220,
  title = "QR thiết lập Authenticator"
}: {
  value: string;
  size?: number;
  title?: string;
}) {
  const modules = qrMatrix(value);
  const quietZone = 4;
  const gridSize = modules.length + quietZone * 2;
  const path: string[] = [];

  for (let row = 0; row < modules.length; row += 1) {
    for (let column = 0; column < modules.length; column += 1) {
      if (!modules[row]![column]) continue;
      const x = column + quietZone;
      const y = row + quietZone;
      path.push(`M${x} ${y}h1v1h-1z`);
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${gridSize} ${gridSize}`}
      role="img"
      aria-label={title}
      style={{
        display: "block",
        maxWidth: "100%",
        height: "auto",
        background: "#ffffff",
        borderRadius: 12
      }}
      shapeRendering="crispEdges"
    >
      <title>{title}</title>
      <rect width={gridSize} height={gridSize} fill="#ffffff" />
      <path d={path.join("")} fill="#000000" />
    </svg>
  );
}
