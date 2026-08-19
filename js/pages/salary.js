// Калькулятор заработной платы: ставка + ГПХ, сравнение с 1,5 ставки.
import { h, money, money0, toast, statCard, download, MONTHS } from '../core/ui.js';
import { getState, update } from '../core/store.js';
import { WORK_DAYS, YEARS, workDays, yearTotal, isPreliminary } from '../data/calendar.js';

/** Расчёт одной ставки по модели из рабочей таблицы. */
export function calcRate(p, rate) {
  const oklad = p.base * rate;
  const fixed = oklad + p.intensive + p.quality;
  const dayCost = p.workDays > 0 ? fixed / p.workDays : 0;
  const rvPrice = dayCost * 2;
  const rvSum = p.rv * rvPrice;
  const baseForCoef = oklad + p.quality + p.intensive + rvSum;
  const district = baseForCoef * (p.district / 100);
  const north = baseForCoef * (p.north / 100);
  const gross = oklad + rvSum + p.intensive + district + north + p.quality;
  const net = gross * (1 - p.ndfl / 100);
  return { rate, oklad, dayCost, rvPrice, rvSum, district, north, gross, net };
}

export function calcAll(p) {
  const half = calcRate(p, 0.5);
  const one = calcRate(p, 1);
  const oneHalf = calcRate(p, 1.5);
  const gphNet = p.gph * (1 - p.ndfl / 100);
  const withGph = one.net + gphNet;
  return { half, one, oneHalf, gphNet, withGph, benefit: withGph - oneHalf.net };
}

const ROWS = [
  ['Оклад', 'oklad'],
  ['Стоимость дня', 'dayCost'],
  ['Цена одного РВ', 'rvPrice'],
  ['Сумма по РВ', 'rvSum'],
  ['Доплата за интенсив', 'intensive'],
  ['Районный коэффициент', 'district'],
  ['Северная надбавка', 'north'],
  ['Надбавка за качество', 'quality'],
];

export function render(root) {
  const st = getState();
  const s = st.salary;

  const field = (label, key, opts = {}) => h('label', { class: 'field' },
    h('span', {}, label),
    h('input', {
      type: 'number', value: s[key], step: opts.step || 'any', min: opts.min ?? 0,
      onInput: (e) => { const v = parseFloat(e.target.value); update(x => { x.salary[key] = isFinite(v) ? v : 0; }); redraw(); },
    }));

  const wrap = h('div', {});
  root.append(wrap);

  function redraw() {
    const st = getState(); const s = st.salary;
    const autoDays = workDays(s.year, s.month, s.calendarOverrides);
    if (autoDays && s.workDays !== autoDays && s.autoDays !== false) { /* значение подставляется кнопкой */ }
    const p = {
      base: s.base, intensive: s.intensive, quality: s.quality, gph: s.gph,
      ndfl: s.ndfl, district: s.district, north: s.north,
      workDays: s.workDays, rv: s.rv,
    };
    const r = calcAll(p);
    wrap.innerHTML = '';

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Калькулятор зарплаты'),
        h('p', {}, `${MONTHS[s.month - 1]} ${s.year} · норма ${autoDays ?? '—'} раб. дн. · введено ${s.workDays} дн., РВ — ${s.rv}`)),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn', onClick: () => saveHistory(r) }, '💾 Сохранить расчёт'),
        h('button', { class: 'btn', onClick: () => exportCsv(r, s) }, '⤓ CSV'),
      )));

    /* --- итоговые плитки --- */
    wrap.append(h('div', { class: 'grid cols-4', style: { marginBottom: '16px' } },
      statCard('1 ставка + ГПХ · на руки', money0(r.withGph), 'ваш текущий формат', ''),
      statCard('1,5 ставки · на руки', money0(r.oneHalf.net), 'полностью официально', 'cyan'),
      statCard(r.benefit >= 0 ? 'Выгода формата с ГПХ' : 'Проигрыш формата с ГПХ',
        (r.benefit >= 0 ? '+' : '−') + money0(Math.abs(r.benefit)),
        `${(Math.abs(r.benefit) / (r.oneHalf.net || 1) * 100).toFixed(1)}% от 1,5 ставки`,
        r.benefit >= 0 ? '' : 'magenta'),
      statCard('1 ставка без НДФЛ', money0(r.one.gross), `на руки ${money0(r.one.net)}`, 'plain'),
    ));

    /* --- ввод --- */
    const monthSel = h('select', {
      onChange: (e) => {
        const m = parseInt(e.target.value, 10);
        update(x => { x.salary.month = m; const d = workDays(x.salary.year, m, x.salary.calendarOverrides); if (d) x.salary.workDays = d; });
        redraw();
      }
    }, ...MONTHS.map((n, i) => h('option', { value: i + 1, selected: s.month === i + 1 }, n)));

    const yearSel = h('select', {
      onChange: (e) => {
        const y = parseInt(e.target.value, 10);
        update(x => { x.salary.year = y; const d = workDays(y, x.salary.month, x.salary.calendarOverrides); if (d) x.salary.workDays = d; });
        redraw();
      }
    }, ...YEARS.map(y => h('option', { value: y, selected: s.year === y }, y + (isPreliminary(y) ? ' (предв.)' : ''))));

    wrap.append(h('div', { class: 'grid cols-2', style: { marginBottom: '16px' } },
      h('div', { class: 'card' },
        h('h3', {}, 'Ежемесячный ввод'),
        h('div', { class: 'card-sub' }, 'Рабочие дни подставляются из производственного календаря — их можно перебить вручную.'),
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', {}, 'Год'), yearSel),
          h('label', { class: 'field' }, h('span', {}, 'Месяц'), monthSel),
        ),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          field('Кол-во рабочих дней', 'workDays', { step: 1 }),
          field('Кол-во РВ (рабочих выходных)', 'rv', { step: 1 }),
          h('button', {
            class: 'btn fixed', onClick: () => {
              const d = workDays(s.year, s.month, s.calendarOverrides);
              if (!d) return toast('Для этого месяца нет данных календаря', 'err');
              update(x => { x.salary.workDays = d; }); redraw(); toast(`Подставлено ${d} раб. дн.`);
            }
          }, '↺ Из календаря'),
        ),
        autoDays && autoDays !== s.workDays
          ? h('p', { class: 'muted', style: { marginTop: '10px', fontSize: '12.5px' } },
              `⚠ В календаре за ${MONTHS[s.month - 1]} ${s.year} — ${autoDays} рабочих дней, а введено ${s.workDays}.`)
          : null,
      ),
      h('div', { class: 'card' },
        h('h3', {}, 'Постоянные величины ', h('span', { class: 'hint' }, '(меняются раз в полгода)')),
        h('div', { class: 'row' }, field('Оклад 1 ставки, ₽', 'base'), field('Доплата за интенсив, ₽', 'intensive')),
        h('div', { class: 'row', style: { marginTop: '10px' } }, field('Надбавка за качество, ₽', 'quality'), field('Сумма ГПХ (начислено), ₽', 'gph')),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          field('НДФЛ, %', 'ndfl'), field('Районный коэф., %', 'district'), field('Северная надбавка, %', 'north')),
      ),
    ));

    /* --- сравнение форматов --- */
    wrap.append(h('div', { class: 'card', style: { marginBottom: '16px' } },
      h('h3', {}, 'Сравнение форматов работы'),
      h('div', { class: 'grid cols-2' },
        h('div', {},
          h('div', { class: 'pill ok', style: { marginBottom: '10px' } }, 'Текущий формат: 1 ставка + ГПХ'),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, '1 ставка, к начислению'), h('span', { class: 'v' }, money(r.one.gross))),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, '1 ставка, на руки'), h('span', { class: 'v' }, money(r.one.net))),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, `ГПХ начислено`), h('span', { class: 'v' }, money(s.gph))),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, `ГПХ после НДФЛ (${s.ndfl}%)`), h('span', { class: 'v' }, money(r.gphNet))),
          h('div', { class: 'kv total' }, h('span', { class: 'k' }, 'Итого на руки'), h('span', { class: 'v' }, money(r.withGph))),
        ),
        h('div', {},
          h('div', { class: 'pill cyan', style: { marginBottom: '10px' } }, 'Альтернатива: 1,5 ставки официально'),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Оклад 1,5 ставки'), h('span', { class: 'v' }, money(r.oneHalf.oklad))),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, 'К начислению без НДФЛ'), h('span', { class: 'v' }, money(r.oneHalf.gross))),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, `НДФЛ ${s.ndfl}%`), h('span', { class: 'v' }, '− ' + money(r.oneHalf.gross - r.oneHalf.net))),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, 'ГПХ'), h('span', { class: 'v muted' }, '—')),
          h('div', { class: 'kv total' }, h('span', { class: 'k' }, 'Итого на руки'), h('span', { class: 'v' }, money(r.oneHalf.net))),
        ),
      ),
      h('hr', { class: 'sep' }),
      h('p', { style: { margin: 0, fontSize: '14px' } },
        r.benefit >= 0
          ? ['Формат ', h('b', { class: 'neon-text' }, '1 ставка + ГПХ'), ' выгоднее 1,5 ставки на ', h('b', { class: 'neon-text' }, money(r.benefit)), ' в месяц — это ', h('b', {}, money(r.benefit * 12)), ' за год.']
          : ['Формат ', h('b', {}, '1,5 ставки'), ' выгоднее на ', h('b', { class: 'neon-text' }, money(-r.benefit)), ' в месяц (', money(-r.benefit * 12), ' за год).']),
    ));

    /* --- детальная таблица --- */
    const cell = (v) => h('td', { class: 'num t-right mono' }, money(v));
    wrap.append(h('div', { class: 'card', style: { marginBottom: '16px' } },
      h('h3', {}, 'Детализация по ставкам'),
      h('div', { class: 'table-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { class: 'sticky-col' }, 'Показатель'),
            h('th', { class: 'num' }, '0,5 ставки'), h('th', { class: 'num' }, '1 ставка'), h('th', { class: 'num' }, '1,5 ставки'))),
          h('tbody', {},
            ...ROWS.map(([label, key]) => h('tr', {},
              h('td', { class: 'sticky-col' }, label),
              cell(key in r.half ? r.half[key] : p[key]),
              cell(key in r.one ? r.one[key] : p[key]),
              cell(key in r.oneHalf ? r.oneHalf[key] : p[key]),
            )),
            h('tr', {}, h('td', { class: 'sticky-col' }, h('b', {}, 'Итого к начислению без НДФЛ')),
              cell(r.half.gross), cell(r.one.gross), cell(r.oneHalf.gross)),
            h('tr', {}, h('td', { class: 'sticky-col' }, h('b', { class: 'neon-text' }, 'Итого к получению')),
              cell(r.half.net), cell(r.one.net), cell(r.oneHalf.net)),
            h('tr', {}, h('td', { class: 'sticky-col' }, h('b', {}, 'С ГПХ на руки')),
              h('td', { class: 'num t-right mono muted' }, '—'),
              h('td', { class: 'num t-right mono neon-text' }, money(r.withGph)),
              h('td', { class: 'num t-right mono muted' }, '—')),
          )))));

    /* --- календарь --- */
    wrap.append(calendarCard(redraw));

    /* --- история --- */
    if (s.history?.length) wrap.append(historyCard(redraw));
  }

  function saveHistory(r) {
    const s = getState().salary;
    update(x => {
      x.salary.history.unshift({
        id: Date.now(), year: s.year, month: s.month, workDays: s.workDays, rv: s.rv,
        gross: r.one.gross, net: r.one.net, withGph: r.withGph, oneHalf: r.oneHalf.net, benefit: r.benefit,
      });
      x.salary.history = x.salary.history.slice(0, 36);
    });
    toast(`Расчёт за ${MONTHS[s.month - 1]} ${s.year} сохранён`); redraw();
  }

  function exportCsv(r, s) {
    const rows = [['Показатель', '0,5 ставки', '1 ставка', '1,5 ставки']];
    const f = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
    for (const [label, key] of ROWS) rows.push([label, f(r.half[key] ?? s[key]), f(r.one[key] ?? s[key]), f(r.oneHalf[key] ?? s[key])]);
    rows.push(['Итого к начислению без НДФЛ', f(r.half.gross), f(r.one.gross), f(r.oneHalf.gross)]);
    rows.push(['Итого к получению', f(r.half.net), f(r.one.net), f(r.oneHalf.net)]);
    rows.push(['ГПХ после НДФЛ', '', f(r.gphNet), '']);
    rows.push(['С ГПХ на руки', '', f(r.withGph), '']);
    rows.push(['Выгода формата с ГПХ', '', f(r.benefit), '']);
    download(`Зарплата_${MONTHS[s.month - 1]}_${s.year}.csv`,
      '﻿' + rows.map(rw => rw.map(v => `"${v}"`).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  redraw();
}

function calendarCard(redraw) {
  const s = getState().salary;
  const body = h('div', { class: 'acc-body' });
  for (const y of YEARS) {
    body.append(h('div', { style: { margin: '10px 0 6px' } },
      h('b', {}, `${y} год`), ' ',
      h('span', { class: 'muted', style: { fontSize: '12.5px' } },
        `— всего ${yearTotal(y, s.calendarOverrides)} рабочих дней${isPreliminary(y) ? ' · предварительно, сверьте с постановлением о переносах' : ''}`)));
    const grid = h('div', { class: 'grid cols-4' });
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${m}`;
      const val = workDays(y, m, s.calendarOverrides);
      grid.append(h('label', { class: 'field' },
        h('span', {}, MONTHS[m - 1]),
        h('input', {
          type: 'number', min: 0, max: 31, value: val ?? '',
          onChange: (e) => {
            const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
            update(x => {
              if (v === null || v === WORK_DAYS[y][m]) delete x.salary.calendarOverrides[key];
              else x.salary.calendarOverrides[key] = v;
              if (x.salary.year === y && x.salary.month === m) x.salary.workDays = v ?? WORK_DAYS[y][m];
            });
            redraw();
          }
        })));
    }
    body.append(grid);
  }
  return h('details', { class: 'acc', style: { marginBottom: '16px' } },
    h('summary', {}, 'Производственный календарь 2026–2027 (можно править)'), body);
}

function historyCard(redraw) {
  const s = getState().salary;
  return h('div', { class: 'card' },
    h('h3', {}, 'Сохранённые расчёты'),
    h('div', { class: 'table-wrap', style: { maxHeight: '340px' } },
      h('table', { class: 'compact' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Период'), h('th', { class: 'num' }, 'Раб. дн.'), h('th', { class: 'num' }, 'РВ'),
          h('th', { class: 'num' }, '1 ставка на руки'), h('th', { class: 'num' }, 'С ГПХ'), h('th', { class: 'num' }, '1,5 ставки'),
          h('th', { class: 'num' }, 'Выгода'), h('th', {}, ''))),
        h('tbody', {}, ...s.history.map(it => h('tr', {},
          h('td', {}, `${MONTHS[it.month - 1]} ${it.year}`),
          h('td', { class: 'num' }, it.workDays), h('td', { class: 'num' }, it.rv),
          h('td', { class: 'num t-right mono' }, money0(it.net)),
          h('td', { class: 'num t-right mono neon-text' }, money0(it.withGph)),
          h('td', { class: 'num t-right mono' }, money0(it.oneHalf)),
          h('td', { class: 'num t-right mono' }, (it.benefit >= 0 ? '+' : '−') + money0(Math.abs(it.benefit))),
          h('td', {}, h('button', {
            class: 'btn sm danger ghost',
            onClick: () => { update(x => { x.salary.history = x.salary.history.filter(z => z.id !== it.id); }); redraw(); }
          }, '×')),
        ))))));
}
