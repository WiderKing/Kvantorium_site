// Единое хранилище состояния (localStorage) + подписки.
const KEY = 'kvantorium28.state.v1';

export const DEFAULTS = {
  version: 1,
  students: null,               // {subjects, stats, sourceName, importedAt}
  schedules: {},                // {"1": {...}, "2": {...}, "3": {...}}
  mapping: {},                  // код расписания -> {subjectId, groupId}
  journal: {},                  // shift -> groupId -> studentId -> lessonKey -> mark
  plan: null,                   // разобранный индивидуальный план
  hoursLog: [],                 // списанные часы
  hoursSettings: { annualNorm: 2000, source: 'manual' },
  hoursTemplates: [],           // пользовательские шаблоны списаний
  salary: {
    base: 21700,
    intensive: 10650,
    quality: 115,
    gph: 22142,
    ndfl: 13,
    district: 30,
    north: 30,
    workDays: 22,
    rv: 2,
    year: 2026,
    month: new Date().getMonth() + 1,
    calendarOverrides: {},      // "2026-1": 15
    history: [],                // сохранённые расчёты
  },
  vedomostHeader: {},           // шапка итоговой ведомости
  vedomostGroups: [],           // группы, попадающие в ведомость
  vedomostMarks: {},            // ручные правки оценок: studentId -> {1,2,3,final}
  ui: { journalShift: 1, journalSubject: null, journalGroup: null },
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function deepDefaults(target, defs) {
  for (const k of Object.keys(defs)) {
    if (target[k] === undefined || target[k] === null && defs[k] !== null) target[k] = clone(defs[k]);
    else if (defs[k] && typeof defs[k] === 'object' && !Array.isArray(defs[k]) && typeof target[k] === 'object') {
      deepDefaults(target[k], defs[k]);
    }
  }
  return target;
}

let state;
try {
  const raw = localStorage.getItem(KEY);
  state = raw ? deepDefaults(JSON.parse(raw), DEFAULTS) : clone(DEFAULTS);
} catch { state = clone(DEFAULTS); }

const listeners = new Set();
let saveTimer = null;

export function getState() { return state; }

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error('Не удалось сохранить состояние', e); }
  }, 120);
}

export function update(fn) {
  fn(state);
  save();
  listeners.forEach(l => l(state));
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function resetAll() {
  state = clone(DEFAULTS);
  localStorage.removeItem(KEY);
  listeners.forEach(l => l(state));
}

export function exportBackup() {
  return JSON.stringify({ app: 'kvantorium28', exportedAt: new Date().toISOString(), state }, null, 2);
}

export function importBackup(json) {
  const data = JSON.parse(json);
  const s = data.state || data;
  if (!s || typeof s !== 'object') throw new Error('Некорректный файл резервной копии.');
  state = deepDefaults(s, DEFAULTS);
  save();
  listeners.forEach(l => l(state));
}

/* ---------- удобные выборки ---------- */
export function allGroups(st = state) {
  const out = [];
  for (const s of st.students?.subjects || []) {
    for (const g of s.groups) out.push({ subject: s, group: g });
  }
  return out;
}

export function findGroup(groupId, st = state) {
  return allGroups(st).find(x => x.group.id === groupId) || null;
}

/** Занятия конкретной группы в заезде — по сопоставленным кодам расписания. */
export function lessonsForGroup(shift, groupId, st = state) {
  const sch = st.schedules[String(shift)];
  if (!sch) return [];
  const codes = Object.entries(st.mapping).filter(([, m]) => m && m.groupId === groupId).map(([c]) => c);
  if (!codes.length) return [];
  const set = new Set(codes);
  return sch.lessons.filter(l => set.has(l.code))
    .sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no);
}

export const lessonKey = (l) => `${l.date}#${l.no}`;
