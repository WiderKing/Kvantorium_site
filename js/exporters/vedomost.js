// Итоговая ведомость: расчёт оценок по заездам и выгрузка в .docx по форме технопарка.
import { buildDocx, p, table } from '../lib/docx-write.js';
import { getState, lessonsForGroup, lessonKey } from '../core/store.js';

export const NA = 'н/а';
export const SHIFTS = [1, 2, 3];

/** Оценка за заезд: округление среднего по оценкам 2–5; нет оценок — «н/а». */
export function shiftGrade(st, groupId, studentId, shift) {
  const cells = st.journal?.[shift]?.[groupId]?.[studentId];
  if (!cells) return NA;
  const lessons = lessonsForGroup(shift, groupId, st);
  const keys = lessons.length ? lessons.map(lessonKey) : Object.keys(cells);
  const grades = keys.map(k => cells[k]).filter(m => /^[2-5]$/.test(m || '')).map(Number);
  if (!grades.length) return NA;
  return String(Math.round(grades.reduce((a, b) => a + b, 0) / grades.length));
}

/** Итоговая: «н/а», если хотя бы один заезд не аттестован; иначе округление среднего по заездам. */
export function finalGrade(marks) {
  if (marks.some(m => m === NA || !m)) return NA;
  const nums = marks.map(Number).filter(n => n >= 2 && n <= 5);
  if (!nums.length) return NA;
  return String(Math.round(nums.reduce((a, b) => a + b, 0) / nums.length));
}

/** Строки ведомости с учётом ручных правок (state.vedomostMarks). */
export function buildRows(st, groups) {
  const overrides = st.vedomostMarks || {};
  return groups.map(({ subject, group, code }) => ({
    code: code || group.name,
    subject, group,
    students: group.students.map((stu, i) => {
      const ov = overrides[stu.id] || {};
      const marks = SHIFTS.map(sh => ov[sh] ?? shiftGrade(st, group.id, stu.id, sh));
      const final = ov.final ?? finalGrade(marks);
      return { no: i + 1, student: stu, name: stu.short || stu.fio, marks, final };
    }),
  }));
}

/** Формирует .docx-ведомость. */
export async function buildVedomostDocx(header, sections) {
  const blocks = [];
  blocks.push(p(header.org, { align: 'center', size: 10, bold: true, spacingAfter: 2 }));
  blocks.push(p(header.tech, { align: 'center', size: 11, bold: true, spacingAfter: 10 }));
  blocks.push(p('Итоговая ведомость', { align: 'center', size: 14, bold: true, spacingAfter: 8 }));
  if (header.program) blocks.push(p(header.program, { align: 'center', size: 11, spacingAfter: 10 }));
  const place = [header.place, header.period ? `(${header.period})` : ''].filter(Boolean).join('      ');
  if (place) blocks.push(p(`агломерация      ${place}`, { align: 'center', size: 11, spacingAfter: 12 }));

  const widths = [8, 40, 13, 13, 13, 13];
  for (const sec of sections) {
    const rows = [];
    rows.push([
      { text: '№ п/п', bold: true, align: 'center' },
      { text: 'Фамилии, имена', bold: true, align: 'center' },
      { text: '1 заезд', bold: true, align: 'center' },
      { text: '2 заезд', bold: true, align: 'center' },
      { text: '3 заезд', bold: true, align: 'center' },
      { text: 'итоговая', bold: true, align: 'center' },
    ]);
    rows.push([{ text: sec.code, bold: true, align: 'center', span: 6, fill: 'F2F2F2' }]);
    for (const r of sec.students) {
      rows.push([
        { text: String(r.no), align: 'center' },
        { text: r.name },
        { text: r.marks[0], align: 'center' },
        { text: r.marks[1], align: 'center' },
        { text: r.marks[2], align: 'center' },
        { text: r.final, align: 'center', bold: true },
      ]);
    }
    blocks.push(table(widths, rows));
    blocks.push(p('', { size: 8, spacingAfter: 6 }));
  }

  blocks.push(p('', { spacingAfter: 8 }));
  blocks.push(p(`Педагог: ${header.teacher}         подпись/_________________`, { size: 11 }));
  return buildDocx(blocks);
}
