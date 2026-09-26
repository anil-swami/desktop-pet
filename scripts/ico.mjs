// Packs PNG images into a Windows .ico file (Vista+ stores PNGs inside as-is).
//
//   ICONDIR (6 bytes)        reserved 0, type 1 (icon), image count
//   ICONDIRENTRY (16 bytes)  per image: width, height (0 means 256), colours,
//                            reserved, planes 1, bits per pixel 32, data size, data offset
//   image data               the PNG files, one after another
//
// images: [{ size, png: Buffer }]

export function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, png }, index) => {
    const entry = index * 16;
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`Icon size must be 1-256, got ${size}`);
    entries.writeUInt8(size === 256 ? 0 : size, entry);     // width
    entries.writeUInt8(size === 256 ? 0 : size, entry + 1); // height
    entries.writeUInt8(0, entry + 2);                       // palette colours (none)
    entries.writeUInt8(0, entry + 3);                       // reserved
    entries.writeUInt16LE(1, entry + 4);                    // colour planes
    entries.writeUInt16LE(32, entry + 6);                   // bits per pixel
    entries.writeUInt32LE(png.length, entry + 8);
    entries.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...images.map(({ png }) => png)]);
}
