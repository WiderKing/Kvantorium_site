// Разбор docx со списком обучающихся -> предметы -> группы -> ученики.
import { readDocx, isMergedRow } from '../lib/docx.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const isGroupRow = (t) => /^группа\s*№?\s*\d+/i.test(norm(t));
const isSchoolRow = (t) => /наименование\s+школы/i.test(t);
const isHeaderRow = (row) => /№\s*п\/?п/i.test(norm(row[0] || '')) || /^ФИО$/i.test(norm(row[2] || ''));

function splitFio(fio) {
  const parts = norm(fio).split(' ').filter(Boolean);
  return {
    last: parts[0] || '',
    first: parts[1] || '',
    middle: parts.slice(2).join(' '),
    short: [parts[0], parts[1]].filter(Boolean).join(' '),
    full: norm(fio),
  };
}

const gradeOf = (title) => {
  const m = /(\d{1,2})\s*класс/i.exec(title || '');
  return m ? parseInt(m[1], 10) : null;
};

let uid = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

/**
 * @returns {{subjects:Array<{id,title,grade,school,groups:Array<{id,name,index,students:Array}>}>, stats:object}}
 */
export function parseStudentsDoc(docxData) {
  const subjects = [];
  for (const table of docxData.tables) {
    const rows = table.rows;
    if (!rows.length) continue;
    let title = isMergedRow(rows[0]) ? norm(rows[0][0]) : '';
    if (!title) {
      // заголовок мог оказаться в первой попавшейся объединённой строке
      const r = rows.find(isMergedRow);
      title = r ? norm(r[0]) : 'Без названия';
    }
    if (isGroupRow(title) || isSchoolRow(title)) continue;

    const subject = {
      id: nextId('sub_'), title, grade: gradeOf(title), school: '',
      groups: [],
    };
    let group = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const first = norm(row[0]);
      if (isMergedRow(row)) {
        if (isSchoolRow(first)) { subject.school = norm(first.split(/:/).slice(1).join(':')) || first; continue; }
        if (isGroupRow(first)) {
          const num = parseInt(/(\d+)/.exec(first)[1], 10);
          group = { id: nextId('grp_'), name: `Группа ${num}`, index: num, students: [] };
          subject.groups.push(group);
          continue;
        }
        continue; // прочие объединённые строки (заголовок)
      }
      if (isHeaderRow(row)) continue;
      const fio = norm(row[2]);
      if (!fio || fio.length < 4 || !/[А-Яа-яЁё]/.test(fio)) continue;
      if (!group) {
        group = { id: nextId('grp_'), name: 'Группа 1', index: 1, students: [] };
        subject.groups.push(group);
      }
      const p = splitFio(fio);
      group.students.push({
        id: nextId('st_'),
        no: norm(row[0]).replace(/\.$/, ''),
        noInGroup: norm(row[1]).replace(/\.$/, ''),
        fio: p.full, last: p.last, first: p.first, middle: p.middle, short: p.short,
        birth: norm(row[3]),
      });
    }
    subject.groups = subject.groups.filter(g => g.students.length);
    if (subject.groups.length) subjects.push(subject);
  }

  const stats = {
    subjects: subjects.length,
    groups: subjects.reduce((a, s) => a + s.groups.length, 0),
    students: subjects.reduce((a, s) => a + s.groups.reduce((b, g) => b + g.students.length, 0), 0),
  };
  return { subjects, stats };
}

export async function importStudentsFile(file) {
  const buf = await file.arrayBuffer();
  const docx = await readDocx(buf);
  const res = parseStudentsDoc(docx);
  if (!res.subjects.length) throw new Error('В документе не найдено ни одной группы обучающихся.');
  res.sourceName = file.name;
  return res;
}

/** Экспорт учеников в CSV (Excel-совместимый, разделитель — точка с запятой). */
export function studentsToCsv(subjects) {
  const rows = [['Предмет', 'Класс', 'Школа', 'Группа', '№ в группе', 'Фамилия', 'Имя', 'Отчество', 'Дата рождения']];
  for (const s of subjects) for (const g of s.groups) for (const st of g.students) {
    rows.push([s.title, s.grade ?? '', s.school, g.name, st.noInGroup, st.last, st.first, st.middle, st.birth]);
  }
  return '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

/* ---------- импорт учеников из CSV (обратная операция к экспорту) ---------- */
function splitCsvLine(line, sep) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(v => v.trim());
}

export function parseStudentsCsv(text) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = clean.split('\n').filter(l => l.trim());
  if (!lines.length) throw new Error('Файл пуст.');
  const sep = (lines[0].split(';').length >= lines[0].split(',').length) ? ';' : ',';
  const head = splitCsvLine(lines[0], sep).map(x => x.toLowerCase());
  const col = (...names) => head.findIndex(hh => names.some(n => hh.includes(n)));
  const iSubject = col('предмет', 'программ');
  const iGrade = col('класс');
  const iSchool = col('школ');
  const iGroup = col('группа');
  const iNo = col('№ в группе', 'номер');
  const iLast = col('фамилия');
  const iFirst = col('имя');
  const iMid = col('отчество');
  const iFio = col('фио');
  const iBirth = col('рожден');
  if (iSubject < 0 || iGroup < 0 || (iLast < 0 && iFio < 0)) {
    throw new Error('В CSV нужны колонки «Предмет», «Группа» и «Фамилия» (или «ФИО»).');
  }
  const subjects = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, sep);
    const subTitle = c[iSubject]; if (!subTitle) continue;
    let sub = subjects.find(s => s.title === subTitle);
    if (!sub) {
      sub = { id: nextId('sub_'), title: subTitle, grade: iGrade >= 0 && c[iGrade] ? parseInt(c[iGrade], 10) : gradeOf(subTitle), school: iSchool >= 0 ? c[iSchool] : '', groups: [] };
      subjects.push(sub);
    }
    const gName = c[iGroup] || 'Группа 1';
    let grp = sub.groups.find(g => g.name === gName);
    if (!grp) {
      grp = { id: nextId('grp_'), name: gName, index: parseInt(/(\d+)/.exec(gName)?.[1] || sub.groups.length + 1, 10), students: [] };
      sub.groups.push(grp);
    }
    const fio = iFio >= 0 && c[iFio] ? c[iFio] : [c[iLast], c[iFirst], iMid >= 0 ? c[iMid] : ''].filter(Boolean).join(' ');
    if (!norm(fio)) continue;
    const pp = splitFio(fio);
    grp.students.push({
      id: nextId('st_'), no: String(grp.students.length + 1), noInGroup: iNo >= 0 ? c[iNo] : String(grp.students.length + 1),
      fio: pp.full, last: pp.last, first: pp.first, middle: pp.middle, short: pp.short,
      birth: iBirth >= 0 ? c[iBirth] : '',
    });
  }
  const withStudents = subjects.filter(s => (s.groups = s.groups.filter(g => g.students.length)).length);
  if (!withStudents.length) throw new Error('В CSV не найдено ни одного ученика.');
  return {
    subjects: withStudents,
    stats: {
      subjects: withStudents.length,
      groups: withStudents.reduce((a, s) => a + s.groups.length, 0),
      students: withStudents.reduce((a, s) => a + s.groups.reduce((b, g) => b + g.students.length, 0), 0),
    },
  };
}

export async function importStudentsCsvFile(file) {
  const res = parseStudentsCsv(await file.text());
  res.sourceName = file.name;
  return res;
}
