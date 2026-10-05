import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, '..', 'web');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    let c = (crc ^ byte) & 0xff;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function generatePng(width, height, r, g, b) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // filter type 0 (None)
    for (let x = 0; x < width; x++) {
      // Draw smooth emerald rounded rect with inner document graphic
      const margin = Math.floor(width * 0.1);
      const inRect = (x >= margin && x < width - margin && y >= margin && y < height - margin);
      const isInnerDoc = (x >= width * 0.3 && x < width * 0.7 && y >= height * 0.25 && y < height * 0.75);
      
      if (isInnerDoc) {
        row[1 + x * 3] = 255;
        row[1 + x * 3 + 1] = 255;
        row[1 + x * 3 + 2] = 255;
      } else if (inRect) {
        row[1 + x * 3] = r;
        row[1 + x * 3 + 1] = g;
        row[1 + x * 3 + 2] = b;
      } else {
        row[1 + x * 3] = 255;
        row[1 + x * 3 + 1] = 253;
        row[1 + x * 3 + 2] = 235; // #FFFDEB background
      }
    }
    rawRows.push(row);
  }

  const idatData = zlib.deflateSync(Buffer.concat(rawRows));
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

fs.writeFileSync(path.join(webDir, 'icon-192.png'), generatePng(192, 192, 16, 185, 129));
fs.writeFileSync(path.join(webDir, 'icon-512.png'), generatePng(512, 512, 16, 185, 129));
fs.writeFileSync(path.join(webDir, 'apple-touch-icon.png'), generatePng(180, 180, 16, 185, 129));

console.log('PWA PNG icons generated successfully.');
