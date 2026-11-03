import { calculateCompensationBreakdown } from './taxCalculator.js';

export const RECOMMENDED_DEFAULT_CATEGORIES = [
  {
    id: 'housing-utilities',
    name: 'Housing + Utilities',
    recommendedPercent: 30,
    color: '#3b82f6', // blue-500
    isDefault: true,
  },
  {
    id: 'groceries',
    name: 'Groceries',
    recommendedPercent: 10,
    color: '#10b981', // emerald-500
    isDefault: true,
  },
  {
    id: 'transportation',
    name: 'Transportation',
    recommendedPercent: 5,
    color: '#06b6d4', // cyan-500
    isDefault: true,
  },
  {
    id: 'car-payments',
    name: 'Car Payments',
    recommendedPercent: 8,
    color: '#f97316', // orange-500
    isDefault: true,
  },
  {
    id: 'investments',
    name: 'Investments',
    recommendedPercent: 15,
    color: '#8b5cf6', // violet-500
    isDefault: true,
  },
  {
    id: 'savings',
    name: 'Savings',
    recommendedPercent: 10,
    color: '#f59e0b', // amber-500
    isDefault: true,
  },
];

export const RECOMMENDED_BONUS_CATEGORIES = [
  {
    id: 'bonus-investments',
    name: 'Investments',
    recommendedPercent: 50,
    color: '#8b5cf6', // violet-500
  },
  {
    id: 'bonus-savings',
    name: 'Savings',
    recommendedPercent: 30,
    color: '#f59e0b', // amber-500
  },
  {
    id: 'bonus-fun',
    name: 'Fun / Travel',
    recommendedPercent: 20,
    color: '#ec4899', // pink-500
  },
];

export const CATEGORY_COLOR_PALETTE = [
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
  '#eab308', // yellow-500
  '#ef4444', // red-500
  '#84cc16', // lime-500
];

export const DEFAULT_COMPENSATION = {
  salary: 140000,
  bonus: 15000,
  stockOptions: 25000,
  filingStatus: 'single',
};

export function buildRecommendedCategoriesForSalary(
  salary = DEFAULT_COMPENSATION.salary,
  filingStatus = DEFAULT_COMPENSATION.filingStatus
) {
  const breakdown = calculateCompensationBreakdown({
    salary,
    bonus: 0,
    stockOptions: 0,
    filingStatus,
  });
  const monthlyTakeHome = breakdown.monthly.netSalaryTakeHome;

  return RECOMMENDED_DEFAULT_CATEGORIES.map((cat) => ({
    id: cat.id,
    name: cat.name,
    recommendedPercent: cat.recommendedPercent,
    color: cat.color,
    isDefault: true,
    monthlyAmount: Math.round((monthlyTakeHome * cat.recommendedPercent) / 100),
  }));
}

export function buildRecommendedBonusCategories(
  compensation = DEFAULT_COMPENSATION
) {
  const breakdown = calculateCompensationBreakdown(compensation);
  const netBonus = breakdown.yearly.netBonus;

  return RECOMMENDED_BONUS_CATEGORIES.map((cat) => ({
    id: cat.id,
    name: cat.name,
    recommendedPercent: cat.recommendedPercent,
    color: cat.color,
    yearlyAmount: Math.round((netBonus * cat.recommendedPercent) / 100),
  }));
}

export function createDefaultYearPlan(year = 2026) {
  return {
    year: String(year),
    compensation: { ...DEFAULT_COMPENSATION },
    categories: buildRecommendedCategoriesForSalary(
      DEFAULT_COMPENSATION.salary,
      DEFAULT_COMPENSATION.filingStatus
    ),
    bonusCategories: buildRecommendedBonusCategories(DEFAULT_COMPENSATION),
  };
}
