// Минимальный читатель ZIP на нативном DecompressionStream — без внешних зависимостей.
// Используется для распаковки .docx и .xlsx (оба — обычные zip-архивы).

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Распаковывает zip-архив.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Map<string,Uint8Array>>} путь внутри архива -> содержимое
 */
export async function unzip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);

  // 1. Находим End Of Central Directory (сигнатура PK\x05\x06), идём с конца.
  let eocd = -1;
  const from = Math.max(0, u8.length - 66000);
  for (let i = u8.length - 22; i >= from; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Файл не является zip-архивом (docx/xlsx повреждён).');

  let entries = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);

  // ZIP64 — на всякий случай (большие xlsx)
  if (cdOffset === 0xffffffff || entries === 0xffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x07064b50) {
        const z64 = Number(dv.getBigUint64(i + 8, true));
        entries = Number(dv.getBigUint64(z64 + 32, true));
        cdOffset = Number(dv.getBigUint64(z64 + 48, true));
        break;
      }
    }
  }

  const utf8 = new TextDecoder('utf-8');
  const files = new Map();
  let p = cdOffset;

  for (let n = 0; n < entries; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;

    // локальный заголовок
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(dataStart, dataStart + compSize);
    files.set(name, { method, raw });
  }

  const out = new Map();
  for (const [name, { method, raw }] of files) {
    out.set(name, method === 0 ? raw.slice() : await inflateRaw(raw));
  }
  return out;
}

/** Читает файл архива как текст UTF-8. */
export function textOf(zipMap, path) {
  const b = zipMap.get(path);
  return b ? new TextDecoder('utf-8').decode(b) : null;
}

/** Разбирает XML-строку в Document. */
export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Не удалось разобрать XML внутри документа.');
  return doc;
}
