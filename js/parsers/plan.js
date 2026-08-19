// Разбор xlsx «Отчёт по индивидуальному плану работы».
// Лист «учебная» -> учебные часы, лист «Метод, Восп» -> методические часы.
import { readXlsx, idxToCol } from '../lib/xlsx.js';

const norm = (s) => (s === null || s === undefined ? '' : String(s)).replace(/\s+/g, ' ').trim();
const isTotalRow = (a) => /^итого/i.test(norm(a));
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : 0;
};

function sheetKind(name) {
  const n = name.toLowerCase();
  if (/метод|восп|организ/.test(n)) return 'method';
  if (/учеб/.test(n)) return 'teaching';
  return null;
}

function findLayout(rows) {
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    if (/№\s*п\/?п/i.test(norm(rows[i]?.[0]))) { headerRow = i; break; }
  }
  if (headerRow < 0) return null;

  // строка с названиями видов работ: ниже шапки, максимум непустых текстовых ячеек с колонки D
  let workRow = -1, best = 0;
  for (let i = headerRow + 1; i < Math.min(headerRow + 6, rows.length); i++) {
    const r = rows[i] || [];
    const cnt = r.filter((v, j) => j >= 3 && norm(v).length > 12).length;
    if (cnt > best) { best = cnt; workRow = i; }
  }
  if (workRow < 0) return null;

  // строка категорий — между шапкой и строкой видов работ
  let catRow = -1;
  for (let i = headerRow + 1; i < workRow; i++) {
    const r = rows[i] || [];
    if (r.some((v, j) => j >= 3 && norm(v))) { catRow = i; break; }
  }
  return { headerRow, catRow, workRow };
}

function readSheet(sheet) {
  const rows = sheet.rows;
  const layout = findLayout(rows);
  if (!layout) return null;
  const { catRow, workRow } = layout;
  const workRowArr = rows[workRow] || [];
  const catArr = catRow >= 0 ? (rows[catRow] || []) : [];

  // колонка «Итого по группам»
  let totalCol = -1;
  catArr.forEach((v, j) => { if (/^итого/i.test(norm(v))) totalCol = j; });

  // категории действуют слева направо до следующей непустой ячейки
  const catAt = [];
  let cur = '';
  for (let j = 0; j < Math.max(catArr.length, workRowArr.length); j++) {
    const v = norm(catArr[j]);
    if (v && !/^итого/i.test(v)) cur = v;
    catAt[j] = cur;
  }

  const works = [];
  workRowArr.forEach((v, j) => {
    const title = norm(v);
    if (!title || j === totalCol || /^итого/i.test(title)) return;
    works.push({ col: j, ref: idxToCol(j), title, category: catAt[j] || '' });
  });
  if (!works.length) return null;

  // блоки данных: строки до/после «Итого работам»
  const entries = [];
  const blocks = [];
  let block = { kind: 'groups', rows: [] };
  for (let i = workRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const a = norm(r[0]);
    if (isTotalRow(a)) {
      if (block.rows.length) { blocks.push(block); block = { kind: 'events', rows: [] }; }
      continue;
    }
    const name = norm(r[1]);
    if (!name) continue;
    const hours = {};
    let sum = 0;
    for (const w of works) { const h = num(r[w.col]); if (h) { hours[w.col] = h; sum += h; } }
    if (!sum) continue;
    const rec = {
      no: a, name, period: norm(r[2]),
      form: works[0].col > 3 ? norm(r[3]) : '',
      hours, total: totalCol >= 0 ? (num(r[totalCol]) || sum) : sum,
      block: block.kind,
    };
    block.rows.push(rec);
    entries.push(rec);
  }
  if (block.rows.length) blocks.push(block);

  // план по каждому виду работ
  for (const w of works) {
    w.planned = entries.reduce((a, e) => a + (e.hours[w.col] || 0), 0);
    const vals = entries.map(e => e.hours[w.col]).filter(Boolean);
    w.presets = [...new Set(vals)].sort((a, b) => b - a).slice(0, 6);
  }

  return {
    name: sheet.name,
    works: works.filter(w => w.planned > 0 || w.title),
    entries,
    blocks,
    total: entries.reduce((a, e) => a + e.total, 0),
  };
}

export function parsePlanWorkbook(wb) {
  const out = { sheets: [], teacher: '', direction: '', year: '' };

  for (const sh of wb.sheets) {
    // мета из шапки
    for (const r of sh.rows.slice(0, 20)) {
      if (!r) continue;
      const a = norm(r[0]);
      const val = r.map(norm).filter(Boolean)[1] || '';
      if (/^преподават/i.test(a) && !out.teacher) out.teacher = val;
      if (/^направлен/i.test(a) && !out.direction) out.direction = val;
      const y = r.map(norm).find(v => /^\d{4}\s*\/\s*\d{2,4}$/.test(v));
      if (y && !out.year) out.year = y;
    }
    const parsed = readSheet(sh);
    if (!parsed) continue;
    parsed.kind = sheetKind(sh.name) || (out.sheets.some(s => s.kind === 'teaching') ? 'method' : 'teaching');
    out.sheets.push(parsed);
  }
  if (!out.sheets.length) throw new Error('В файле не найден индивидуальный план (нет колонок с видами работ).');

  // сводный справочник видов работ
  const works = [];
  for (const sh of out.sheets) {
    for (const w of sh.works) {
      works.push({
        id: `${sh.kind}:${w.ref}`,
        sheet: sh.name, kind: sh.kind, ref: w.ref,
        title: w.title, category: w.category,
        planned: w.planned, presets: w.presets,
      });
    }
  }
  out.works = works;
  out.totals = {
    teaching: out.sheets.filter(s => s.kind === 'teaching').reduce((a, s) => a + s.total, 0),
    method: out.sheets.filter(s => s.kind === 'method').reduce((a, s) => a + s.total, 0),
  };
  out.totals.all = out.totals.teaching + out.totals.method;
  return out;
}

export async function importPlanFile(file) {
  const wb = await readXlsx(await file.arrayBuffer());
  const res = parsePlanWorkbook(wb);
  res.sourceName = file.name;
  return res;
}
