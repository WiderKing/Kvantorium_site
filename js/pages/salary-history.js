// «История зарплат»: архив по сохранённым расчётам — годы колонками, внутри
// 12 месяцев с суммой на руки. Клик по месяцу открывает полную раскладку
// (те же карточки, что и на вкладке расчёта) и выгрузку расчётного листка.
import { h, money0, toast, download, confirmBox, modal, MONTHS, emptyState } from '../core/ui.js';
import { getState, update } from '../core/store.js';
import { comparisonCard, detailTableCard } from './salary.js';
import { buildPayslipDocx } from '../exporters/payslip.js';
import { go } from '../core/router.js';

const findEntry = (history, year, month) => history.find(h => h.year === year && h.month === month) || null;

export function render(root) {
  const wrap = h('div', {});
  root.append(wrap);
  redraw();

  function redraw() {
    const st = getState();
    const s = st.salary;
    wrap.innerHTML = '';

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'История зарплат'),
        h('p', {}, 'Архив расчётов, сохранённых на вкладке «Расчёт по месяцам». Один месяц — одна запись: повторное сохранение заменяет прежнюю.'))));

    wrap.append(requisitesCard(redraw));

    const years = [...new Set(s.history.map(h => h.year))].sort((a, b) => a - b);
    if (!years.length) {
      wrap.append(h('div', { class: 'card' }, emptyState('📜',
        'Пока ничего не сохранено. Посчитайте месяц на вкладке «Расчёт по месяцам» и нажмите «💾 Сохранить расчёт».',
        h('button', { class: 'btn primary', onClick: () => { update(x => { x.ui.salaryTab = 'calc'; }); go('salary'); } }, 'К расчёту зарплаты'))));
      return;
    }

    const grid = h('div', {
      class: 'scroll-x',
      style: { display: 'flex', gap: '14px', alignItems: 'flex-start', paddingBottom: '4px' },
    });
    for (const y of years) grid.append(yearColumn(y, s, redraw));
    wrap.append(grid);
  }

  function yearColumn(year, s, redraw) {
    const rows = [];
    let filled = 0, total = 0;
    for (let m = 1; m <= 12; m++) {
      const entry = findEntry(s.history, year, m);
      if (entry) { filled++; total += entry.net; }
      rows.push(h('div', {
        class: 'kv' + (entry ? ' month-row clickable' : ' month-row'),
        onClick: entry ? () => openMonth(entry, redraw) : null,
      },
        h('span', { class: 'k' }, MONTHS[m - 1]),
        h('span', { class: entry ? 'v' : 'v muted' }, entry ? money0(entry.net) : '—')));
    }
    return h('div', { class: 'card', style: { flex: '0 0 240px', minWidth: '240px' } },
      h('h3', {}, String(year), h('span', { class: 'hint' }, ` ${filled}/12`)),
      ...rows,
      filled ? h('div', { class: 'kv total', style: { marginTop: '8px' } },
        h('span', { class: 'k' }, 'Сумма за год'), h('span', { class: 'v' }, money0(total))) : null);
  }

  function openMonth(entry, outerRedraw) {
    const st = getState();
    const requisites = st.salary.requisites || {};
    const one = entry.calc.one;

    const body = h('div', {});
    body.append(h('div', { class: 'grid cols-3', style: { marginBottom: '16px' } },
      h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, 'На руки (1 ставка)'),
        h('div', { class: 'value' }, money0(one.net)),
        h('div', { class: 'sub' }, `до НДФЛ ${money0(one.gross)}`))),
      h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, 'С ГПХ на руки'),
        h('div', { class: 'value cyan' }, money0(entry.calc.withGph)),
        h('div', { class: 'sub' }, `ГПХ ${money0(entry.params.gph)} · после НДФЛ ${money0(entry.calc.gphNet)}`))),
      h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, 'Отработано'),
        h('div', { class: 'value plain' }, one.partial ? `${one.fact} из ${one.norm} дн.` : `${one.norm} дн. (полный)`),
        h('div', { class: 'sub' }, `РВ: ${entry.params.rv || 0} · сохранено ${new Date(entry.savedAt || entry.id).toLocaleString('ru-RU')}`))),
    ));

    body.append(comparisonCard(entry.calc, entry.params));
    body.append(detailTableCard(entry.calc, entry.params));

    body.append(h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' } },
      h('button', {
        class: 'btn primary', onClick: async () => {
          try {
            const blob = await buildPayslipDocx(entry, requisites);
            download(`Расчётный_листок_${MONTHS[entry.month - 1]}_${entry.year}.docx`, blob);
            toast('Расчётный листок выгружен');
          } catch (e) { console.error(e); toast('Ошибка выгрузки: ' + e.message, 'err'); }
        }
      }, '⤓ Расчётный листок (Word)'),
      h('button', {
        class: 'btn', onClick: () => {
          update(x => {
            Object.assign(x.salary, entry.params, { partialMonth: entry.params.factDays != null, year: entry.year, month: entry.month });
            x.ui.salaryTab = 'calc';
          });
          go('salary');
        }
      }, '✎ Открыть в расчёте'),
      h('button', {
        class: 'btn danger ghost', onClick: () => confirmBox(`Удалить сохранённый расчёт за ${MONTHS[entry.month - 1]} ${entry.year}?`, () => {
          update(x => { x.salary.history = x.salary.history.filter(h => h.id !== entry.id); });
          document.querySelector('.modal-back')?.remove();
          toast('Запись удалена'); outerRedraw();
        })
      }, '🗑 Удалить'),
    ));

    modal({ wide: true, title: `${MONTHS[entry.month - 1]} ${entry.year}`, body, okText: null, cancelText: 'Закрыть' });
  }
}

function requisitesCard(redraw) {
  const st = getState();
  const r = st.salary.requisites || {};
  const fioValue = r.fio || st.plan?.teacher || '';

  const field = (label, key, value, placeholder) => h('label', { class: 'field' },
    h('span', {}, label),
    h('input', {
      type: 'text', value, placeholder,
      onChange: (e) => { update(x => { x.salary.requisites = { ...(x.salary.requisites || {}), [key]: e.target.value }; }); redraw(); },
    }));

  return h('details', { class: 'acc', style: { marginBottom: '16px' } },
    h('summary', {}, 'Реквизиты для расчётного листка'),
    h('div', { class: 'acc-body' },
      h('div', { class: 'card-sub', style: { marginTop: 0 } }, 'Подставляются в шапку выгружаемого расчётного листка — заполните один раз.'),
      h('div', { class: 'row' },
        field('Организация', 'org', r.org || ''),
        field('Подразделение', 'unit', r.unit || '')),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        field('Должность', 'position', r.position || ''),
        field('Табельный номер', 'tabNo', r.tabNo || '')),
      h('div', { style: { marginTop: '10px' } },
        field('ФИО', 'fio', fioValue, 'подставится из «Часов» (Преподаватель), если оставить пустым')),
    ));
}
