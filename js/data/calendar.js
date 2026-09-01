// Производственный календарь РФ (пятидневная рабочая неделя).
// Значения рассчитаны по нерабочим праздничным дням и переносам выходных.
// 2025 и 2026 — официальные (переносы утверждены постановлениями Правительства
// РФ №1587 от 25.10.2023 и №2381 от 27.10.2024). 2027 год предварительный —
// постановление о переносах публикуется осенью, поэтому любое число можно
// поправить вручную в настройках расчёта.

export const WORK_DAYS = {
  2025: { 1: 17, 2: 19, 3: 20, 4: 22, 5: 18, 6: 20, 7: 23, 8: 21, 9: 22, 10: 23, 11: 19, 12: 22 },
  2026: { 1: 15, 2: 19, 3: 21, 4: 22, 5: 19, 6: 21, 7: 23, 8: 21, 9: 22, 10: 22, 11: 20, 12: 22 },
  2027: { 1: 13, 2: 19, 3: 22, 4: 22, 5: 19, 6: 21, 7: 22, 8: 22, 9: 22, 10: 21, 11: 21, 12: 23 },
};

export const YEARS = Object.keys(WORK_DAYS).map(Number).sort();

export function workDays(year, month, overrides = {}) {
  const key = `${year}-${month}`;
  if (overrides && overrides[key] != null && overrides[key] !== '') return Number(overrides[key]);
  return WORK_DAYS[year]?.[month] ?? null;
}

export function yearTotal(year, overrides = {}) {
  let s = 0;
  for (let m = 1; m <= 12; m++) s += workDays(year, m, overrides) || 0;
  return s;
}

export const isPreliminary = (year) => year >= 2027;
