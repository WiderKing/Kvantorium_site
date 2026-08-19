// Чтение .xlsx без внешних зависимостей: sharedStrings + styles + листы -> матрицы значений.
import { unzip, textOf, parseXml } from './zip.js';

const colToIdx = (letters) => {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
};
export const idxToCol = (i) => {
  let s = '';
  i++;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function serialToDate(n) {
  // Excel: 1 = 1900-01-01, с известным багом 1900 года
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (isNaN(d)) return null;
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

function readSharedStrings(zip) {
  const xml = textOf(zip, 'xl/sharedStrings.xml');
  if (!xml) return [];
  const doc = parseXml(xml);
  return Array.from(doc.getElementsByTagName('*'))
    .filter(el => el.localName === 'si')
    .map(si => Array.from(si.getElementsByTagName('*'))
      .filter(n => n.localName === 't')
      .map(n => n.textContent).join(''));
}

function readStyles(zip) {
  const xml = textOf(zip, 'xl/styles.xml');
  if (!xml) return [];
  const doc = parseXml(xml);
  const all = Array.from(doc.getElementsByTagName('*'));
  const custom = new Map();
  for (const el of all) {
    if (el.localName === 'numFmt') {
      const id = parseInt(el.getAttribute('numFmtId'), 10);
      const code = el.getAttribute('formatCode') || '';
      custom.set(id, code);
    }
  }
  const cellXfs = all.find(el => el.localName === 'cellXfs');
  if (!cellXfs) return [];
  return Array.from(cellXfs.children).map(xf => {
    const id = parseInt(xf.getAttribute('numFmtId') || '0', 10);
    const code = custom.get(id) || '';
    const isDate = DATE_FMT_IDS.has(id) || /(^|[^\\])[dmyh]/i.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''));
    return { numFmtId: id, isDate };
  });
}

function sheetOrder(zip) {
  const wbXml = textOf(zip, 'xl/workbook.xml');
  const relXml = textOf(zip, 'xl/_rels/workbook.xml.rels');
  if (!wbXml) return [];
  const rels = new Map();
  if (relXml) {
    for (const r of Array.from(parseXml(relXml).getElementsByTagName('*'))) {
      if (r.localName === 'Relationship') rels.set(r.getAttribute('Id'), r.getAttribute('Target'));
    }
  }
  const out = [];
  for (const el of Array.from(parseXml(wbXml).getElementsByTagName('*'))) {
    if (el.localName !== 'sheet') continue;
    const rid = el.getAttribute('r:id') || el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = rels.get(rid) || `worksheets/sheet${out.length + 1}.xml`;
    if (target.startsWith('/')) target = target.slice(1);
    else if (!target.startsWith('xl/')) target = 'xl/' + target;
    out.push({ name: el.getAttribute('name') || `Лист${out.length + 1}`, path: target });
  }
  return out;
}

/**
 * @returns {Promise<{names:string[], sheets:Array<{name:string, rows:Array<Array<string|number|null>>}>}>}
 * rows — плотная матрица, индекс 0 = строка 1 листа.
 */
export async function readXlsx(arrayBuffer) {
  const zip = await unzip(arrayBuffer);
  const shared = readSharedStrings(zip);
  const styles = readStyles(zip);
  const sheetsMeta = sheetOrder(zip);
  const sheets = [];

  for (const meta of sheetsMeta) {
    const xml = textOf(zip, meta.path);
    if (!xml) continue;
    const doc = parseXml(xml);
    const rows = [];
    let maxCol = 0;
    for (const rowEl of Array.from(doc.getElementsByTagName('*'))) {
      if (rowEl.localName !== 'row') continue;
      const rIdx = parseInt(rowEl.getAttribute('r') || String(rows.length + 1), 10) - 1;
      const arr = [];
      for (const c of Array.from(rowEl.children)) {
        if (c.localName !== 'c') continue;
        const ref = c.getAttribute('r') || '';
        const m = /^([A-Z]+)/.exec(ref);
        const ci = m ? colToIdx(m[1]) : arr.length;
        const t = c.getAttribute('t');
        const sIdx = parseInt(c.getAttribute('s') || '-1', 10);
        let value = null;
        if (t === 'inlineStr') {
          value = Array.from(c.getElementsByTagName('*')).filter(n => n.localName === 't').map(n => n.textContent).join('');
        } else {
          const vEl = Array.from(c.children).find(n => n.localName === 'v');
          const raw = vEl ? vEl.textContent : null;
          if (raw === null || raw === '') value = null;
          else if (t === 's') value = shared[parseInt(raw, 10)] ?? '';
          else if (t === 'str' || t === 'e') value = raw;
          else if (t === 'b') value = raw === '1' ? 'ИСТИНА' : 'ЛОЖЬ';
          else {
            const num = Number(raw);
            const st = styles[sIdx];
            value = (st && st.isDate && isFinite(num) && num > 20000) ? (serialToDate(num) ?? num) : (isFinite(num) ? num : raw);
          }
        }
        arr[ci] = value;
        if (ci + 1 > maxCol) maxCol = ci + 1;
      }
      rows[rIdx] = arr;
    }
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i]) rows[i] = [];
      for (let j = 0; j < maxCol; j++) if (rows[i][j] === undefined) rows[i][j] = null;
    }
    sheets.push({ name: meta.name, rows });
  }
  return { names: sheets.map(s => s.name), sheets };
}
