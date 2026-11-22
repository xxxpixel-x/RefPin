import zlib from 'node:zlib';

// ---- Pure Node PNG encoder (for crisp RefPin extension icons) ----

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter None
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    r
  );
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/**
 * 绘制 RefPin 图标：炭黑圆角方底 (#1C1917) + 纯白几何 "R" + 右上角琥珀金浮页圆点 (#D97706)
 */
export function renderRefPinIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 4; // 4x4 SSAA 抗锯齿

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      let aAcc = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          // 归一化坐标 [-1, 1]
          const u = ((x + (sx + 0.5) / samples) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / samples) / size) * 2 - 1;

          // 1) 圆角方底
          const bgDist = sdRoundedBox(u, v, 0.88, 0.88, 0.34);
          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0;

          if (bgDist <= 0) {
            cr = 0x1c;
            cg = 0x19;
            cb = 0x17;
            ca = 1;

            // 2) 几何字母 R（居中偏左下，给右上琥珀金浮标留白）
            const stroke = 0.115;
            const stem = sdSegment(u, v, -0.34, -0.44, -0.34, 0.48) - stroke;
            const topBar = sdSegment(u, v, -0.34, -0.44, 0.04, -0.44) - stroke;
            const midBar = sdSegment(u, v, -0.34, 0.03, 0.04, 0.03) - stroke;
            // 右半圆弧：圆心 (0.04, -0.205)，半径 0.235
            const arcDx = u - 0.04;
            const arcDy = v - -0.205;
            const arcRing =
              arcDx >= 0
                ? Math.abs(Math.hypot(arcDx, arcDy) - 0.235) - stroke
                : 1;
            const leg = sdSegment(u, v, -0.02, 0.05, 0.28, 0.48) - stroke;

            const letterDist = Math.min(stem, topBar, midBar, arcRing, leg);
            if (letterDist <= 0) {
              cr = 0xff;
              cg = 0xff;
              cb = 0xff;
            }
          }

          // 3) 右上角琥珀金浮页圆点（带深色微描边）
          const dotDist = Math.hypot(u - 0.62, v - -0.62);
          if (dotDist <= 0.27) {
            if (dotDist <= 0.20) {
              cr = 0xd9;
              cg = 0x77;
              cb = 0x06;
              ca = 1;
            } else {
              cr = 0xf7;
              cg = 0xf6;
              cb = 0xf3;
              ca = 1;
            }
          }

          rAcc += cr * ca;
          gAcc += cg * ca;
          bAcc += cb * ca;
          aAcc += ca;
        }
      }

      const n = samples * samples;
      const alpha = aAcc / n;
      const idx = (y * size + x) * 4;
      if (alpha > 0) {
        rgba[idx] = Math.round(rAcc / aAcc);
        rgba[idx + 1] = Math.round(gAcc / aAcc);
        rgba[idx + 2] = Math.round(bAcc / aAcc);
        rgba[idx + 3] = Math.round(alpha * 255);
      }
    }
  }

  return encodePng(size, size, rgba);
}
