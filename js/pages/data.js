// Страница «Данные»: импорт docx/xlsx, сопоставление кодов расписания с группами, резервные копии.
import { h, toast, fileDrop, download, modal, confirmBox, dateRu, emptyState, pickFile } from '../core/ui.js';
import { getState, update, resetAll, exportBackup, importBackup, allGroups } from '../core/store.js';
import { importStudentsFile, importStudentsCsvFile, studentsToCsv } from '../parsers/students.js';
import { importScheduleFile, autoMatch, parseCode } from '../parsers/schedule.js';
import { importPlanFile } from '../parsers/plan.js';
import { SHIFTS } from './journal.js';
import { go } from '../core/router.js';

export function render(root) {
  const wrap = h('div', {});
  root.append(wrap);

  function redraw() {
    const st = getState();
    wrap.innerHTML = '';
    wrap.append(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Данные'), h('p', {}, 'Импорт документов, сопоставление групп и резервные копии. Всё хранится локально в браузере.')),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn', onClick: () => download(`Кванториум28_бэкап_${new Date().toISOString().slice(0, 10)}.json`, exportBackup(), 'application/json') }, '⤓ Выгрузить всё'),
        h('button', { class: 'btn', onClick: () => pickFile('.json', async f => {
          try { importBackup(await f.text()); toast('Резервная копия загружена'); redraw(); }
          catch (e) { toast('Ошибка: ' + e.message, 'err'); }
        }) }, '⤒ Загрузить копию'),
        h('button', { class: 'btn danger', onClick: () => confirmBox('Удалить все данные приложения (списки, расписания, журнал, часы, настройки зарплаты)?', () => { resetAll(); toast('Данные очищены'); redraw(); }) }, '🗑 Очистить'),
      )));

    wrap.append(h('div', { style: { marginBottom: '16px' } }, studentsCard(st, redraw)));
    wrap.append(scheduleCard(st, redraw));
    wrap.append(h('div', { style: { marginBottom: '16px' } }, mappingCard(st, redraw)));
    wrap.append(planCard(st, redraw));
  }

  redraw();
}

/* ---------------- список обучающихся ---------------- */
function studentsCard(st, redraw) {
  const s = st.students;
  const body = h('div', {});
  if (s) {
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Файл'), h('span', { class: 'v' }, s.sourceName || '—')));
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Предметов / групп / детей'),
      h('span', { class: 'v' }, `${s.stats.subjects} / ${s.stats.groups} / ${s.stats.students}`)));
    const list = h('div', { style: { marginTop: '10px' } });
    for (const sub of s.subjects) {
      list.append(h('div', { style: { margin: '8px 0 4px', fontSize: '13px', fontWeight: '700' } }, sub.title,
        sub.grade ? h('span', { class: 'pill cyan', style: { marginLeft: '8px' } }, sub.grade + ' класс') : null));
      list.append(h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        ...sub.groups.map(g => h('span', { class: 'pill' }, `${g.name} · ${g.students.length}`))));
    }
    body.append(list);
    body.append(h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm', onClick: () => download('Обучающиеся.csv', studentsToCsv(s.subjects), 'text/csv;charset=utf-8') }, '⤓ Экспорт учеников (CSV)'),
      h('button', { class: 'btn sm', onClick: () => pickCsv(redraw) }, '⤒ Импорт учеников (CSV)'),
      h('button', { class: 'btn sm', onClick: () => go('journal') }, 'Открыть журнал →'),
    ));
  }
  if (!s) body.append(h('div', { style: { marginBottom: '10px' } },
    h('button', { class: 'btn sm', onClick: () => pickCsv(redraw) }, '⤒ Импорт учеников из CSV')));
  body.append(fileDrop({
    title: s ? 'Загрузить другой список обучающихся (.docx)' : 'Список обучающихся (.docx)',
    hint: 'дети автоматически разбиваются по предметам и группам',
    accept: '.docx',
    onFile: async (file) => {
      try {
        const res = await importStudentsFile(file);
        update(x => {
          x.students = { ...res, importedAt: new Date().toISOString() };
          x.ui.journalSubject = res.subjects[0]?.id || null;
          x.ui.journalGroup = res.subjects[0]?.groups[0]?.id || null;
        });
        autoMapAll();
        toast(`Загружено: ${res.stats.groups} групп, ${res.stats.students} детей`);
        redraw();
      } catch (e) { console.error(e); toast('Ошибка импорта: ' + e.message, 'err'); }
    },
  }));
  return h('div', { class: 'card' }, h('h3', {}, '1. Список обучающихся'), body);
}

function pickCsv(redraw) {
  pickFile('.csv,text/csv', async (file) => {
    try {
      const res = await importStudentsCsvFile(file);
      update(x => {
        x.students = { ...res, importedAt: new Date().toISOString() };
        x.ui.journalSubject = res.subjects[0]?.id || null;
        x.ui.journalGroup = res.subjects[0]?.groups[0]?.id || null;
      });
      autoMapAll();
      toast(`Из CSV загружено: ${res.stats.groups} групп, ${res.stats.students} детей`);
      redraw();
    } catch (e) { console.error(e); toast('Ошибка импорта CSV: ' + e.message, 'err'); }
  });
}

/* ---------------- индивидуальный план ---------------- */
function planCard(st, redraw) {
  const p = st.plan;
  const body = h('div', {});
  if (p) {
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Файл'), h('span', { class: 'v' }, p.sourceName || '—')));
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Педагог'), h('span', { class: 'v' }, p.teacher || '—')));
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Учебные часы по плану'), h('span', { class: 'v' }, Math.round(p.totals.teaching))));
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Методические часы по плану'), h('span', { class: 'v' }, Math.round(p.totals.method))));
    body.append(h('div', { class: 'kv total' }, h('span', { class: 'k' }, 'Всего'), h('span', { class: 'v' }, Math.round(p.totals.all))));
    body.append(h('div', { style: { marginTop: '12px' } },
      h('button', { class: 'btn sm', onClick: () => go('hours') }, 'Открыть счётчик часов →')));
  }
  body.append(fileDrop({
    title: p ? 'Загрузить другой индивидуальный план (.xlsx)' : 'Индивидуальный план (.xlsx)',
    hint: 'листы «учебная» и «Метод, Восп»',
    accept: '.xlsx',
    onFile: async (file) => {
      try {
        const plan = await importPlanFile(file);
        update(x => { x.plan = { ...plan, importedAt: new Date().toISOString() }; });
        toast(`План загружен: ${plan.works.length} видов работ`);
        redraw();
      } catch (e) { console.error(e); toast('Ошибка импорта: ' + e.message, 'err'); }
    },
  }));
  return h('div', { class: 'card' }, h('h3', {}, '4. Индивидуальный план'), body);
}

/* ---------------- расписание ---------------- */
function scheduleCard(st, redraw) {
  const cards = SHIFTS.map(shift => {
    const sc = st.schedules[String(shift)];
    const body = h('div', {});
    if (sc) {
      body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Файл'), h('span', { class: 'v', style: { fontSize: '11px' } }, sc.sourceName || '—')));
      body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Занятий'), h('span', { class: 'v' }, sc.lessons.length)));
      body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Даты'),
        h('span', { class: 'v', style: { fontSize: '12px' } }, sc.dates.length ? `${dateRu(sc.dates[0])} – ${dateRu(sc.dates.at(-1))}` : '—')));
      body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Педагоги'), h('span', { class: 'v', style: { fontSize: '11.5px' } }, sc.teachers.join(', ') || '—')));
      body.append(h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '10px 0' } },
        ...sc.codes.map(c => h('span', { class: 'pill' + (st.mapping[c] ? ' ok' : ' warn') }, c))));
      body.append(h('div', { style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'btn sm', onClick: () => showLessons(sc, shift) }, 'Показать занятия'),
        h('button', {
          class: 'btn sm danger', onClick: () => confirmBox(`Удалить расписание ${shift} заезда?`, () => {
            update(x => { delete x.schedules[String(shift)]; }); redraw();
          })
        }, 'Удалить')));
    }
    body.append(fileDrop({
      title: sc ? `Заменить расписание ${shift} заезда` : `Расписание ${shift} заезда (.docx)`,
      hint: 'номер заезда определяется из шапки документа',
      accept: '.docx',
      onFile: async (file) => {
        try {
          const res = await importScheduleFile(file);
          const detected = res.shift;
          const target = detected && detected !== shift
            ? await askShift(detected, shift) : shift;
          update(x => { x.schedules[String(target)] = { ...res, importedAt: new Date().toISOString() }; });
          autoMapAll();
          toast(`Расписание ${target} заезда загружено: ${res.lessons.length} занятий`);
          redraw();
        } catch (e) { console.error(e); toast('Ошибка импорта: ' + e.message, 'err'); }
      },
    }));
    return h('div', { class: 'card' }, h('h3', {}, `Заезд ${shift}`, sc ? h('span', { class: 'pill ok', style: { marginLeft: '8px' } }, 'загружен') : null), body);
  });

  return h('div', { style: { marginBottom: '16px' } },
    h('h2', { style: { fontSize: '16px', margin: '0 0 10px' } }, '2. Расписание занятий — по одному документу на заезд'),
    h('div', { class: 'grid cols-3' }, ...cards));
}

function askShift(detected, chosen) {
  return new Promise(resolve => {
    modal({
      title: 'Номер заезда',
      body: h('p', {}, `В документе указан ${detected} заезд, а файл загружается в ячейку ${chosen} заезда. Куда сохранить?`),
      okText: `В ${detected} заезд (как в документе)`,
      cancelText: `В ${chosen} заезд`,
      onOk: () => resolve(detected),
    });
    // при закрытии без выбора — берём ячейку, в которую перетащили
    const back = document.querySelector('.modal-back');
    const obs = new MutationObserver(() => { if (!document.body.contains(back)) { obs.disconnect(); resolve(chosen); } });
    obs.observe(document.getElementById('modal-root'), { childList: true });
  });
}

function showLessons(sc, shift) {
  const rows = sc.lessons.map(l => h('tr', {},
    h('td', { class: 'mono' }, dateRu(l.date)), h('td', {}, l.weekday), h('td', { class: 'num' }, l.no),
    h('td', { class: 'mono' }, l.time), h('td', {}, l.code), h('td', {}, l.teacher), h('td', { class: 'muted' }, l.direction)));
  modal({
    wide: true, title: `Занятия ${shift} заезда · ${sc.lessons.length}`,
    body: h('div', { class: 'table-wrap' }, h('table', { class: 'compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Дата'), h('th', {}, 'День'), h('th', {}, '№'), h('th', {}, 'Время'), h('th', {}, 'Код'), h('th', {}, 'Педагог'), h('th', {}, 'Направление'))),
      h('tbody', {}, ...rows))),
    okText: null, cancelText: 'Закрыть',
  });
}

/* ---------------- сопоставление кодов ---------------- */
export function autoMapAll() {
  const st = getState();
  const subjects = st.students?.subjects || [];
  if (!subjects.length) return 0;
  const codes = new Set();
  for (const sh of SHIFTS) for (const c of (st.schedules[String(sh)]?.codes || [])) codes.add(c);
  let n = 0;
  update(x => {
    for (const c of codes) {
      if (x.mapping[c]) continue;
      const m = autoMatch(c, subjects);
      if (m) { x.mapping[c] = m; n++; }
    }
  });
  return n;
}

function mappingCard(st, redraw) {
  const codes = new Set();
  for (const sh of SHIFTS) for (const c of (st.schedules[String(sh)]?.codes || [])) codes.add(c);
  const list = [...codes].sort();
  const groups = allGroups(st);

  if (!list.length) {
    return h('div', { class: 'card' }, h('h3', {}, '3. Сопоставление групп'),
      emptyState('🔗', 'Загрузите расписание — коды групп появятся здесь для сопоставления со списком детей.'));
  }

  const rows = list.map(code => {
    const p = parseCode(code);
    const cur = st.mapping[code];
    const sel = h('select', {
      onChange: (e) => {
        const v = e.target.value;
        update(x => {
          if (!v) delete x.mapping[code];
          else { const [subjectId, groupId] = v.split('|'); x.mapping[code] = { subjectId, groupId }; }
        });
        redraw();
      }
    },
      h('option', { value: '' }, '— не сопоставлено —'),
      ...groups.map(({ subject, group }) => h('option', {
        value: `${subject.id}|${group.id}`,
        selected: cur?.groupId === group.id,
      }, `${subject.title} · ${group.name} (${group.students.length})`)));

    const usedIn = SHIFTS.filter(sh => (st.schedules[String(sh)]?.codes || []).includes(code));
    return h('tr', {},
      h('td', {}, h('b', { class: 'mono' }, code)),
      h('td', { class: 'muted', style: { fontSize: '12px' } },
        p ? `${p.prefix} · группа ${p.group}${p.grade ? ` · ${p.grade} класс` : ''}` : ''),
      h('td', {}, ...usedIn.map(s => h('span', { class: 'pill', style: { marginRight: '4px' } }, `${s} заезд`))),
      h('td', { style: { minWidth: '340px' } }, sel),
      h('td', {}, cur ? h('span', { class: 'pill ok' }, '✓') : h('span', { class: 'pill warn' }, '!')),
    );
  });

  return h('div', { class: 'card' },
    h('h3', {}, '3. Сопоставление кодов расписания с группами'),
    h('div', { class: 'card-sub' }, 'Коды вида «Т1 РШ7» связываются с группами из списка автоматически: буква — направление, цифра — номер группы, последняя цифра — класс. Проверьте и поправьте, где нужно.'),
    h('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } },
      h('button', { class: 'btn sm', onClick: () => { const n = autoMapAll(); toast(n ? `Сопоставлено автоматически: ${n}` : 'Новых совпадений не найдено'); redraw(); } }, '⚡ Сопоставить автоматически'),
      h('button', { class: 'btn sm danger ghost', onClick: () => { update(x => { x.mapping = {}; }); redraw(); } }, 'Сбросить сопоставление')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Код'), h('th', {}, 'Разбор'), h('th', {}, 'Заезды'), h('th', {}, 'Группа из списка'), h('th', {}, ''))),
      h('tbody', {}, ...rows))));
}
