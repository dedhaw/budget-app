import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus,
  RotateCcw,
  Undo2,
  Redo2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Lock,
  Unlock,
} from 'lucide-react';
import { calculateCompensationBreakdown } from './utils/taxCalculator.js';
import {
  CATEGORY_COLOR_PALETTE,
  buildRecommendedCategoriesForSalary,
  buildRecommendedBonusCategories,
  createDefaultYearPlan,
} from './utils/defaultBudget.js';

const STORAGE_KEY = 'wa_budget_yearly_plans_v1';

function formatMoney(value) {
  const num = Math.max(0, Math.round(Number(value) || 0));
  return num.toLocaleString('en-US');
}

/**
 * Rebalances a category list so the total never exceeds maxTotal.
 * Locked categories (c.locked === true) are preserved and never scaled down.
 */
function rebalanceCategories(list, targetId, requestedAmount, maxTotal, key) {
  const cap = Math.max(0, Number(maxTotal) || 0);

  const lockedOtherSum = list.reduce(
    (sum, c) =>
      c.id !== targetId && c.locked
        ? sum + Math.max(0, Number(c[key]) || 0)
        : sum,
    0
  );
  const unlockedOtherSum = list.reduce(
    (sum, c) =>
      c.id !== targetId && !c.locked
        ? sum + Math.max(0, Number(c[key]) || 0)
        : sum,
    0
  );

  const maxAvailableForTarget = Math.max(0, cap - lockedOtherSum);
  const clampedTarget = Math.max(
    0,
    Math.min(maxAvailableForTarget, Math.max(0, Number(requestedAmount) || 0))
  );

  // If there is enough leftover room, only update the target category
  if (clampedTarget + lockedOtherSum + unlockedOtherSum <= cap) {
    return list.map((c) =>
      c.id === targetId ? { ...c, [key]: clampedTarget } : c
    );
  }

  // Otherwise, scale down only the unlocked other categories so total === cap
  const remainingForUnlocked = Math.max(
    0,
    cap - lockedOtherSum - clampedTarget
  );
  return list.map((c) => {
    if (c.id === targetId) {
      return { ...c, [key]: clampedTarget };
    }
    if (c.locked) {
      return c;
    }
    const currentVal = Math.max(0, Number(c[key]) || 0);
    const scaledVal =
      unlockedOtherSum > 0
        ? (currentVal * remainingForUnlocked) / unlockedOtherSum
        : 0;
    return { ...c, [key]: Math.max(0, scaledVal) };
  });
}

function EditableNumberInput({
  value,
  onChange,
  prefix,
  suffix,
  placeholder = '0',
  className = '',
  step = 'any',
  disabled = false,
}) {
  const safeValue = Math.max(0, Number(value) || 0);
  const [localStr, setLocalStr] = useState(String(safeValue));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setLocalStr(safeValue === 0 || safeValue ? String(safeValue) : '');
    }
  }, [safeValue, isFocused]);

  const handleChange = (e) => {
    if (disabled) return;
    const raw = e.target.value.replace(/-/g, '');
    if (raw === '') {
      setLocalStr('');
      onChange(0);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(0, parsed);
      setLocalStr(parsed < 0 ? String(clamped) : raw);
      onChange(clamped);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === '-') {
      e.preventDefault();
    }
  };

  return (
    <div className={`relative flex items-center ${className}`}>
      {prefix && (
        <span className="absolute left-3 text-slate-400 font-medium select-none pointer-events-none">
          {prefix}
        </span>
      )}
      <input
        type="number"
        min="0"
        step={step}
        disabled={disabled}
        value={isFocused ? localStr : safeValue === 0 ? '0' : String(safeValue)}
        placeholder={placeholder}
        onFocus={() => {
          setIsFocused(true);
          setLocalStr(safeValue === 0 ? '' : String(safeValue));
        }}
        onBlur={() => {
          setIsFocused(false);
        }}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        className={`w-full border rounded-xl py-2 font-semibold focus:outline-none transition ${
          disabled
            ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
            : 'bg-white border-slate-300 text-slate-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20'
        } ${prefix ? 'pl-7' : 'pl-3'} ${suffix ? 'pr-8' : 'pr-3'}`}
      />
      {suffix && (
        <span className="absolute right-3 text-slate-400 text-sm font-medium select-none pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

function BudgetPieChart({ items, totalBase }) {
  const slices = useMemo(() => {
    if (totalBase <= 0) return [];
    const mapped = items
      .map((item) => {
        const amt = Number(item.amount) || 0;
        const pct = Math.max(0, (amt / totalBase) * 100);
        return {
          id: item.id,
          name: item.name,
          color: item.color,
          amount: amt,
          pct,
        };
      })
      .filter((s) => s.pct > 0);

    const totalPct = mapped.reduce((sum, i) => sum + i.pct, 0);
    if (totalPct < 100) {
      mapped.push({
        id: 'unallocated',
        name: 'Leftover',
        color: '#e2e8f0',
        amount: totalBase * ((100 - totalPct) / 100),
        pct: 100 - totalPct,
      });
    }
    return mapped;
  }, [items, totalBase]);

  if (totalBase <= 0) {
    return (
      <div className="text-center py-6 text-sm text-slate-400">
        Enter an amount above $0 to see the chart
      </div>
    );
  }

  const totalSlicePct = slices.reduce((s, i) => s + i.pct, 0) || 100;
  let cumulativeAngle = 0;

  const getCoordinatesForAngle = (angleInDegrees) => {
    const radians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: 100 + 85 * Math.cos(radians),
      y: 100 + 85 * Math.sin(radians),
    };
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-8 py-2">
      <svg viewBox="0 0 200 200" className="w-48 h-48 shrink-0">
        {slices.map((slice) => {
          const sliceAngle = (slice.pct / totalSlicePct) * 360;
          if (sliceAngle >= 359.9) {
            return (
              <circle
                key={slice.id}
                cx="100"
                cy="100"
                r="85"
                fill={slice.color}
              />
            );
          }
          const startAngle = cumulativeAngle;
          const endAngle = cumulativeAngle + sliceAngle;
          cumulativeAngle = endAngle;

          const start = getCoordinatesForAngle(endAngle);
          const end = getCoordinatesForAngle(startAngle);
          const largeArcFlag = sliceAngle > 180 ? 1 : 0;

          const pathData = [
            `M 100 100`,
            `L ${start.x} ${start.y}`,
            `A 85 85 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
            `Z`,
          ].join(' ');

          return (
            <path
              key={slice.id}
              d={pathData}
              fill={slice.color}
              stroke="#ffffff"
              strokeWidth="2"
            >
              <title>{`${slice.name}: ${slice.pct.toFixed(1)}%`}</title>
            </path>
          );
        })}
      </svg>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
        {slices.map((slice) => (
          <div key={slice.id} className="flex items-center gap-2">
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0"
              style={{ backgroundColor: slice.color }}
            />
            <span className="text-slate-700 font-medium">{slice.name}</span>
            <span className="font-bold text-slate-900">
              {slice.pct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [plans, setPlansRaw] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          const migrated = {};
          for (const key of Object.keys(parsed)) {
            const plan = parsed[key];
            if (plan && Array.isArray(plan.categories)) {
              const id = plan.id || `plan-${key}`;
              const yr = plan.year || key;
              const breakdown = calculateCompensationBreakdown(plan.compensation);
              const monthlyNet = breakdown.monthly.netSalaryTakeHome;

              plan.categories = plan.categories.filter(
                (c) => c.id !== 'transportation-car'
              );

              const hasTransport = plan.categories.some(
                (c) =>
                  c.id === 'transportation' ||
                  c.name.toLowerCase() === 'transportation'
              );
              const hasCarPayments = plan.categories.some(
                (c) =>
                  c.id === 'car-payments' ||
                  c.name.toLowerCase() === 'car payments'
              );

              if (!hasTransport) {
                plan.categories.splice(2, 0, {
                  id: 'transportation',
                  name: 'Transportation',
                  recommendedPercent: 5,
                  color: '#06b6d4',
                  isDefault: true,
                  monthlyAmount: Math.round((monthlyNet * 5) / 100),
                });
              }

              if (!hasCarPayments) {
                plan.categories.splice(3, 0, {
                  id: 'car-payments',
                  name: 'Car Payments',
                  recommendedPercent: 8,
                  color: '#f97316',
                  isDefault: true,
                  monthlyAmount: Math.round((monthlyNet * 8) / 100),
                });
              }

              if (
                !Array.isArray(plan.bonusCategories) ||
                plan.bonusCategories.length === 0
              ) {
                plan.bonusCategories = buildRecommendedBonusCategories(
                  plan.compensation
                );
              }

              migrated[id] = {
                ...plan,
                id,
                year: String(yr),
              };
            }
          }
          if (Object.keys(migrated).length > 0) {
            return migrated;
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
    const defaultPlan = createDefaultYearPlan(2026);
    return {
      'plan-2026': { ...defaultPlan, id: 'plan-2026', year: '2026' },
    };
  });

  const [history, setHistory] = useState({ past: [], future: [] });
  const lastHistoryPushTimeRef = useRef(0);
  const plansRef = useRef(plans);
  useEffect(() => {
    plansRef.current = plans;
  }, [plans]);

  const setPlans = useCallback((updater, options = {}) => {
    const { recordHistory = true } = options;
    const prev = plansRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;

    if (recordHistory) {
      const now = Date.now();
      const shouldCoalesce = now - lastHistoryPushTimeRef.current < 500;
      lastHistoryPushTimeRef.current = now;
      setHistory((h) => {
        if (shouldCoalesce && h.past.length > 0) {
          return { past: h.past, future: [] };
        }
        return {
          past: [...h.past.slice(-99), prev],
          future: [],
        };
      });
    }

    plansRef.current = next;
    setPlansRaw(next);
  }, []);

  const handleUndo = useCallback(() => {
    lastHistoryPushTimeRef.current = 0;
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1];
      const newPast = h.past.slice(0, -1);
      const current = plansRef.current;
      plansRef.current = previous;
      setPlansRaw(previous);
      return {
        past: newPast,
        future: [current, ...h.future.slice(0, 99)],
      };
    });
  }, []);

  const handleRedo = useCallback(() => {
    lastHistoryPushTimeRef.current = 0;
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      const newFuture = h.future.slice(1);
      const current = plansRef.current;
      plansRef.current = next;
      setPlansRaw(next);
      return {
        past: [...h.past.slice(-99), current],
        future: newFuture,
      };
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  const sortedPlans = useMemo(
    () =>
      Object.values(plans).sort(
        (a, b) => (Number(a.year) || 0) - (Number(b.year) || 0)
      ),
    [plans]
  );

  const [activePlanId, setActivePlanId] = useState(
    () => sortedPlans[0]?.id || 'plan-2026'
  );
  const [activeMainView, setActiveMainView] = useState('planner'); // 'planner' | 'multi-year'
  const [activeTab, setActiveTab] = useState('monthly'); // 'monthly' | 'yearly'
  const [rangeStartPlanId, setRangeStartPlanId] = useState('');
  const [rangeEndPlanId, setRangeEndPlanId] = useState('');
  const [showTaxDetails, setShowTaxDetails] = useState(false);

  // Add category inputs (Salary budget)
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryPercent, setNewCategoryPercent] = useState('5');

  // Add category inputs (Bonus budget in Yearly View)
  const [newBonusCatName, setNewBonusCatName] = useState('');
  const [newBonusCatPercent, setNewBonusCatPercent] = useState('10');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
    } catch (e) {
      console.error(e);
    }
  }, [plans]);

  const currentPlan = plans[activePlanId] || sortedPlans[0];

  const taxBreakdown = useMemo(() => {
    if (!currentPlan) return null;
    return calculateCompensationBreakdown(currentPlan.compensation);
  }, [currentPlan]);

  if (!currentPlan || !taxBreakdown) return null;

  const monthlyNetSalary = taxBreakdown.monthly.netSalaryTakeHome;
  const yearlyNetSalary = taxBreakdown.yearly.netSalary;
  const yearlyNetBonus = taxBreakdown.yearly.netBonus;
  const yearlyNetStock = taxBreakdown.yearly.netStock;
  const yearlyNetTotal = taxBreakdown.yearly.netTotalTakeHome;

  const isMonthly = activeTab === 'monthly';
  const isMultiYear = activeMainView === 'multi-year';
  const activeSalaryTakeHome = isMonthly ? monthlyNetSalary : yearlyNetSalary;

  const totalMonthlySpent = currentPlan.categories.reduce(
    (sum, c) => sum + (Number(c.monthlyAmount) || 0),
    0
  );
  const totalYearlySalarySpent = totalMonthlySpent * 12;
  const activeSpent = Math.min(
    activeSalaryTakeHome,
    isMonthly ? totalMonthlySpent : totalYearlySalarySpent
  );
  const activeLeftover = Math.max(0, activeSalaryTakeHome - activeSpent);
  const activeSpentPercent =
    activeSalaryTakeHome > 0
      ? Math.min(100, (activeSpent / activeSalaryTakeHome) * 100)
      : 0;

  // Combined Investments + Savings (for Yearly View top cards)
  const isSavedCategory = (c) => {
    const name = (c.name || '').toLowerCase();
    return (
      c.id === 'investments' ||
      c.id === 'savings' ||
      c.id === 'bonus-investments' ||
      c.id === 'bonus-savings' ||
      name.includes('invest') ||
      name.includes('saving')
    );
  };

  const yearlySalarySaved = currentPlan.categories
    .filter(isSavedCategory)
    .reduce((sum, c) => sum + (Number(c.monthlyAmount) || 0) * 12, 0);
  const yearlySalarySavedPercent =
    yearlyNetSalary > 0
      ? Math.min(100, (yearlySalarySaved / yearlyNetSalary) * 100)
      : 0;

  // Bonus categories math (Yearly tab)
  const bonusCategories = currentPlan.bonusCategories || [];
  const rawBonusSpent = bonusCategories.reduce(
    (sum, c) => sum + (Number(c.yearlyAmount) || 0),
    0
  );
  const totalBonusSpent = Math.min(yearlyNetBonus, rawBonusSpent);
  const bonusLeftover = Math.max(0, yearlyNetBonus - totalBonusSpent);
  const bonusSpentPercent =
    yearlyNetBonus > 0
      ? Math.min(100, (totalBonusSpent / yearlyNetBonus) * 100)
      : 0;

  const yearlyBonusSaved = bonusCategories
    .filter(isSavedCategory)
    .reduce((sum, c) => sum + (Number(c.yearlyAmount) || 0), 0);
  const yearlyBonusSavedPercent =
    yearlyNetBonus > 0
      ? Math.min(100, (yearlyBonusSaved / yearlyNetBonus) * 100)
      : 0;

  const updateCurrentPlan = (updater) => {
    const targetId = currentPlan.id;
    setPlans((prev) => ({
      ...prev,
      [targetId]: updater(prev[targetId]),
    }));
  };

  const handleYearChange = (planId, newYearStr) => {
    const cleanStr = String(newYearStr).replace(/-/g, '');
    const nextYear =
      cleanStr === '' ? '' : String(Math.max(0, Number(cleanStr) || 0));
    setPlans((prev) => ({
      ...prev,
      [planId]: {
        ...prev[planId],
        year: nextYear,
      },
    }));
  };

  const handleCompChange = (field, value) => {
    const safeValue =
      field === 'filingStatus' ? value : Math.max(0, Number(value) || 0);
    updateCurrentPlan((plan) => {
      const nextComp = {
        ...plan.compensation,
        [field]: safeValue,
      };
      const nextTax = calculateCompensationBreakdown(nextComp);
      const nextMonthlyCap = nextTax.monthly.netSalaryTakeHome;
      const nextBonusCap = nextTax.yearly.netBonus;

      const curMonthlySum = plan.categories.reduce(
        (s, c) => s + (Number(c.monthlyAmount) || 0),
        0
      );
      const nextCategories =
        curMonthlySum > nextMonthlyCap && curMonthlySum > 0
          ? plan.categories.map((c) => ({
              ...c,
              monthlyAmount:
                ((Number(c.monthlyAmount) || 0) * nextMonthlyCap) / curMonthlySum,
            }))
          : plan.categories;

      const curBonusList = plan.bonusCategories || [];
      const curBonusSum = curBonusList.reduce(
        (s, c) => s + (Number(c.yearlyAmount) || 0),
        0
      );
      const nextBonusCategories =
        curBonusSum > nextBonusCap && curBonusSum > 0
          ? curBonusList.map((c) => ({
              ...c,
              yearlyAmount:
                ((Number(c.yearlyAmount) || 0) * nextBonusCap) / curBonusSum,
            }))
          : curBonusList;

      return {
        ...plan,
        compensation: nextComp,
        categories: nextCategories,
        bonusCategories: nextBonusCategories,
      };
    });
  };

  // Salary Category Handlers
  const handleCategoryAmountChange = (id, newAmountInView) => {
    const monthlyAmount = isMonthly ? newAmountInView : newAmountInView / 12;
    updateCurrentPlan((plan) => ({
      ...plan,
      categories: rebalanceCategories(
        plan.categories,
        id,
        monthlyAmount,
        monthlyNetSalary,
        'monthlyAmount'
      ),
    }));
  };

  const handleCategoryPercentChange = (id, newPct) => {
    const clampedPct = Math.max(0, Math.min(100, Number(newPct) || 0));
    const dollarInView = (activeSalaryTakeHome * clampedPct) / 100;
    const monthlyAmount = isMonthly ? dollarInView : dollarInView / 12;
    updateCurrentPlan((plan) => ({
      ...plan,
      categories: rebalanceCategories(
        plan.categories,
        id,
        monthlyAmount,
        monthlyNetSalary,
        'monthlyAmount'
      ),
    }));
  };

  const handleCategoryNameChange = (id, newName) => {
    updateCurrentPlan((plan) => ({
      ...plan,
      categories: plan.categories.map((c) =>
        c.id === id ? { ...c, name: newName } : c
      ),
    }));
  };

  const handleAddCategory = (e) => {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    const pct = Math.max(0, Math.min(100, Number(newCategoryPercent) || 0));
    const dollarInView = (activeSalaryTakeHome * pct) / 100;
    const monthlyAmount = isMonthly ? dollarInView : dollarInView / 12;
    const color =
      CATEGORY_COLOR_PALETTE[
        currentPlan.categories.length % CATEGORY_COLOR_PALETTE.length
      ];
    const newId = `cat-${Date.now()}`;

    updateCurrentPlan((plan) => {
      const withNew = [
        ...plan.categories,
        {
          id: newId,
          name,
          recommendedPercent: null,
          color,
          monthlyAmount: 0,
        },
      ];
      return {
        ...plan,
        categories: rebalanceCategories(
          withNew,
          newId,
          Math.round(monthlyAmount),
          monthlyNetSalary,
          'monthlyAmount'
        ),
      };
    });
    setNewCategoryName('');
    setNewCategoryPercent('5');
  };

  const handleDeleteCategory = (id) => {
    updateCurrentPlan((plan) => ({
      ...plan,
      categories: plan.categories.filter((c) => c.id !== id),
    }));
  };

  const handleToggleCategoryLock = (id) => {
    updateCurrentPlan((plan) => ({
      ...plan,
      categories: plan.categories.map((c) =>
        c.id === id ? { ...c, locked: !c.locked } : c
      ),
    }));
  };

  const handleToggleBonusLock = (id) => {
    updateCurrentPlan((plan) => ({
      ...plan,
      bonusCategories: (plan.bonusCategories || []).map((c) =>
        c.id === id ? { ...c, locked: !c.locked } : c
      ),
    }));
  };

  const handleResetSalaryCategories = () => {
    updateCurrentPlan((plan) => ({
      ...plan,
      categories: buildRecommendedCategoriesForSalary(
        plan.compensation.salary,
        plan.compensation.filingStatus
      ),
    }));
  };

  // Bonus Category Handlers (Yearly View)
  const handleBonusAmountChange = (id, newYearlyAmount) => {
    updateCurrentPlan((plan) => ({
      ...plan,
      bonusCategories: rebalanceCategories(
        plan.bonusCategories || [],
        id,
        newYearlyAmount,
        yearlyNetBonus,
        'yearlyAmount'
      ),
    }));
  };

  const handleBonusPercentChange = (id, newPct) => {
    const clampedPct = Math.max(0, Math.min(100, Number(newPct) || 0));
    const yearlyAmount = Math.round((yearlyNetBonus * clampedPct) / 100);
    updateCurrentPlan((plan) => ({
      ...plan,
      bonusCategories: rebalanceCategories(
        plan.bonusCategories || [],
        id,
        yearlyAmount,
        yearlyNetBonus,
        'yearlyAmount'
      ),
    }));
  };

  const handleBonusNameChange = (id, newName) => {
    updateCurrentPlan((plan) => ({
      ...plan,
      bonusCategories: (plan.bonusCategories || []).map((c) =>
        c.id === id ? { ...c, name: newName } : c
      ),
    }));
  };

  const handleAddBonusCategory = (e) => {
    e.preventDefault();
    const name = newBonusCatName.trim();
    if (!name) return;
    const pct = Math.max(0, Math.min(100, Number(newBonusCatPercent) || 0));
    const yearlyAmount = Math.round((yearlyNetBonus * pct) / 100);
    const color =
      CATEGORY_COLOR_PALETTE[
        bonusCategories.length % CATEGORY_COLOR_PALETTE.length
      ];
    const newId = `bonus-cat-${Date.now()}`;

    updateCurrentPlan((plan) => {
      const withNew = [
        ...(plan.bonusCategories || []),
        {
          id: newId,
          name,
          recommendedPercent: null,
          color,
          yearlyAmount: 0,
        },
      ];
      return {
        ...plan,
        bonusCategories: rebalanceCategories(
          withNew,
          newId,
          yearlyAmount,
          yearlyNetBonus,
          'yearlyAmount'
        ),
      };
    });
    setNewBonusCatName('');
    setNewBonusCatPercent('10');
  };

  const handleDeleteBonusCategory = (id) => {
    updateCurrentPlan((plan) => ({
      ...plan,
      bonusCategories: (plan.bonusCategories || []).filter((c) => c.id !== id),
    }));
  };

  const handleResetBonusCategories = () => {
    updateCurrentPlan((plan) => ({
      ...plan,
      bonusCategories: buildRecommendedBonusCategories(plan.compensation),
    }));
  };

  const handleAddNextYear = () => {
    const years = sortedPlans.map((p) => Number(p.year) || 2026);
    const maxYear = years.length > 0 ? Math.max(...years) : 2025;
    const nextYear = String(maxYear + 1);
    const newId = `plan-${Date.now()}`;
    setPlans((prev) => ({
      ...prev,
      [newId]: {
        id: newId,
        year: nextYear,
        compensation: { ...currentPlan.compensation },
        categories: currentPlan.categories.map((c) => ({ ...c })),
        bonusCategories: (currentPlan.bonusCategories || []).map((c) => ({
          ...c,
        })),
      },
    }));
    setActivePlanId(newId);
  };

  const handleDeleteYear = (idToDelete) => {
    if (sortedPlans.length <= 1) return;
    setPlans((prev) => {
      const copy = { ...prev };
      delete copy[idToDelete];
      return copy;
    });
    if (currentPlan.id === idToDelete) {
      const remaining = sortedPlans.filter((p) => p.id !== idToDelete);
      if (remaining[0]) setActivePlanId(remaining[0].id);
    }
  };

  const salaryPieItems = currentPlan.categories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    amount: isMonthly
      ? Number(c.monthlyAmount) || 0
      : (Number(c.monthlyAmount) || 0) * 12,
  }));

  const bonusPieItems = bonusCategories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    amount: Number(c.yearlyAmount) || 0,
  }));

  const multiYearData = useMemo(() => {
    if (sortedPlans.length === 0) return null;

    const firstId = sortedPlans[0].id;
    const lastId = sortedPlans[sortedPlans.length - 1].id;

    const validStartId = sortedPlans.some((p) => p.id === rangeStartPlanId)
      ? rangeStartPlanId
      : firstId;
    const validEndId = sortedPlans.some((p) => p.id === rangeEndPlanId)
      ? rangeEndPlanId
      : lastId;

    const idxA = sortedPlans.findIndex((p) => p.id === validStartId);
    const idxB = sortedPlans.findIndex((p) => p.id === validEndId);
    const startIdx = Math.max(0, Math.min(idxA, idxB));
    const endIdx = Math.max(idxA, idxB);

    const selectedPlans = sortedPlans.slice(startIdx, endIdx + 1);

    let cumulativeSaved = 0;
    let cumulativeNetWorth = 0;
    let totalSalarySaved = 0;
    let totalBonusSaved = 0;
    let totalLiquidStockSaved = 0;
    let totalUnliquidatedStock = 0;
    let totalLeftover = 0;
    let totalTakeHome = 0;

    const categoryTotalsMap = new Map();

    const perYearRows = selectedPlans.map((plan) => {
      const breakdown = calculateCompensationBreakdown(plan.compensation);
      const yrNetSalary = breakdown.yearly.netSalary;
      const yrNetBonus = breakdown.yearly.netBonus;
      const yrNetStock = breakdown.yearly.netStock;
      const yrGrossStock = breakdown.yearly.grossStock;
      const yrStockLiquidatable =
        plan.compensation?.stockLiquidatable !== false;
      const yrNetTotal = breakdown.yearly.netTotalTakeHome;

      const cats = plan.categories || [];
      const bCats = plan.bonusCategories || [];

      const yrSalarySpent =
        cats.reduce((s, c) => s + (Number(c.monthlyAmount) || 0), 0) * 12;
      const yrSalaryAllocated = Math.min(yrNetSalary, yrSalarySpent);
      const yrSalaryLeftover = Math.max(0, yrNetSalary - yrSalaryAllocated);

      const yrBonusSpent = bCats.reduce(
        (s, c) => s + (Number(c.yearlyAmount) || 0),
        0
      );
      const yrBonusAllocated = Math.min(yrNetBonus, yrBonusSpent);
      const yrBonusLeftover = Math.max(0, yrNetBonus - yrBonusAllocated);

      const yrSalarySaved = cats
        .filter(isSavedCategory)
        .reduce((s, c) => s + (Number(c.monthlyAmount) || 0) * 12, 0);

      const yrBonusSaved = bCats
        .filter(isSavedCategory)
        .reduce((s, c) => s + (Number(c.yearlyAmount) || 0), 0);

      const yrLiquidStock = yrStockLiquidatable ? yrNetStock : 0;
      const yrSaved = yrSalarySaved + yrBonusSaved + yrLiquidStock;
      const yrLeftover = yrSalaryLeftover + yrBonusLeftover;
      const yrNetWorth = yrSaved + yrLeftover;
      const yrSavingsRate = yrNetTotal > 0 ? (yrSaved / yrNetTotal) * 100 : 0;

      cumulativeSaved += yrSaved;
      cumulativeNetWorth += yrNetWorth;
      totalSalarySaved += yrSalarySaved;
      totalBonusSaved += yrBonusSaved;
      totalLiquidStockSaved += yrLiquidStock;
      if (!yrStockLiquidatable && yrGrossStock > 0) {
        totalUnliquidatedStock += yrGrossStock;
      }
      totalLeftover += yrLeftover;
      totalTakeHome += yrNetTotal;

      // Aggregate saved categories across years
      cats.filter(isSavedCategory).forEach((c) => {
        const amt = (Number(c.monthlyAmount) || 0) * 12;
        if (amt <= 0) return;
        const key = (c.name || '').trim().toLowerCase() || c.id;
        if (categoryTotalsMap.has(key)) {
          const ex = categoryTotalsMap.get(key);
          ex.salaryAmount += amt;
          ex.amount += amt;
        } else {
          categoryTotalsMap.set(key, {
            id: `multi-cat-${key}`,
            name: c.name,
            color: c.color,
            salaryAmount: amt,
            bonusAmount: 0,
            stockAmount: 0,
            amount: amt,
          });
        }
      });

      bCats.filter(isSavedCategory).forEach((c) => {
        const amt = Number(c.yearlyAmount) || 0;
        if (amt <= 0) return;
        const key = (c.name || '').trim().toLowerCase() || c.id;
        if (categoryTotalsMap.has(key)) {
          const ex = categoryTotalsMap.get(key);
          ex.bonusAmount += amt;
          ex.amount += amt;
        } else {
          categoryTotalsMap.set(key, {
            id: `multi-cat-${key}`,
            name: c.name,
            color: c.color,
            salaryAmount: 0,
            bonusAmount: amt,
            stockAmount: 0,
            amount: amt,
          });
        }
      });

      if (yrLiquidStock > 0) {
        const key = '__liquid_stock__';
        if (categoryTotalsMap.has(key)) {
          const ex = categoryTotalsMap.get(key);
          ex.stockAmount += yrLiquidStock;
          ex.amount += yrLiquidStock;
        } else {
          categoryTotalsMap.set(key, {
            id: 'multi-cat-liquid-stock',
            name: 'Stock / Equity (Liquidatable)',
            color: '#6366f1',
            salaryAmount: 0,
            bonusAmount: 0,
            stockAmount: yrLiquidStock,
            amount: yrLiquidStock,
          });
        }
      }

      return {
        id: plan.id,
        year: plan.year || '----',
        yrNetTotal,
        yrSalarySaved,
        yrBonusSaved,
        yrLiquidStock,
        yrStockLiquidatable,
        yrGrossStock,
        yrSaved,
        yrLeftover,
        yrNetWorth,
        yrSavingsRate,
        cumulativeSaved,
        cumulativeNetWorth,
      };
    });

    const overallSavingsRate =
      totalTakeHome > 0 ? (cumulativeSaved / totalTakeHome) * 100 : 0;

    return {
      validStartId,
      validEndId,
      startYearLabel: selectedPlans[0]?.year || '----',
      endYearLabel: selectedPlans[selectedPlans.length - 1]?.year || '----',
      yearCount: selectedPlans.length,
      totalSaved: cumulativeSaved,
      totalNetWorth: cumulativeNetWorth,
      totalSalarySaved,
      totalBonusSaved,
      totalLiquidStockSaved,
      totalUnliquidatedStock,
      totalLeftover,
      totalTakeHome,
      overallSavingsRate,
      perYearRows,
      savedCategoryBreakdown: Array.from(categoryTotalsMap.values()),
    };
  }, [sortedPlans, rangeStartPlanId, rangeEndPlanId]);

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header Bar */}
        <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200/80 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-slate-900">Budget Planner</h1>

          <div className="flex flex-wrap items-center gap-2">
            {/* Top-Level Main View Switcher */}
            <div className="inline-flex items-center rounded-xl bg-slate-100 p-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveMainView('planner')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  !isMultiYear
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Budget Planner
              </button>
              <button
                type="button"
                onClick={() => setActiveMainView('multi-year')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  isMultiYear
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Multi-Year Savings ({sortedPlans[0]?.year || '----'}–
                {sortedPlans[sortedPlans.length - 1]?.year || '----'})
              </button>
            </div>

            {/* Undo / Redo Buttons */}
            <div className="inline-flex items-center rounded-xl bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={handleUndo}
                disabled={history.past.length === 0}
                title="Undo (Ctrl+Z / Cmd+Z)"
                aria-label="Undo"
                className={`p-1.5 rounded-lg transition ${
                  history.past.length > 0
                    ? 'text-slate-700 hover:bg-white hover:text-slate-900 hover:shadow-xs cursor-pointer'
                    : 'text-slate-300 cursor-not-allowed'
                }`}
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={history.future.length === 0}
                title="Redo (Ctrl+Y / Cmd+Shift+Z)"
                aria-label="Redo"
                className={`p-1.5 rounded-lg transition ${
                  history.future.length > 0
                    ? 'text-slate-700 hover:bg-white hover:text-slate-900 hover:shadow-xs cursor-pointer'
                    : 'text-slate-300 cursor-not-allowed'
                }`}
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Year Selector Section */}
        <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200/80 flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 shrink-0 pl-1">
            Years
          </span>
          <div className="flex items-center gap-2 overflow-x-auto flex-1 py-1 scroll-smooth">
            {sortedPlans.map((plan) => {
              const active = plan.id === currentPlan.id;
              return (
                <div
                  key={plan.id}
                  onClick={() => {
                    setActivePlanId(plan.id);
                    if (isMultiYear) setActiveMainView('planner');
                  }}
                  className={`inline-flex items-center shrink-0 rounded-xl text-sm font-semibold transition cursor-pointer ${
                    active && !isMultiYear
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {active && !isMultiYear ? (
                    <input
                      type="number"
                      min="0"
                      value={plan.year}
                      onKeyDown={(e) => {
                        if (e.key === '-') e.preventDefault();
                      }}
                      onChange={(e) => handleYearChange(plan.id, e.target.value)}
                      aria-label="Edit Year"
                      className="w-18 px-2.5 py-2 bg-transparent text-white font-bold text-center focus:outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setActivePlanId(plan.id);
                        if (isMultiYear) setActiveMainView('planner');
                      }}
                      className="px-3.5 py-2 cursor-pointer"
                    >
                      {plan.year || '----'}
                    </button>
                  )}
                  {sortedPlans.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteYear(plan.id);
                      }}
                      className={`pr-2.5 pl-0.5 py-2 text-xs cursor-pointer ${
                        active && !isMultiYear
                          ? 'text-blue-200 hover:text-white'
                          : 'text-slate-400 hover:text-red-600'
                      }`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleAddNextYear}
            className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl text-sm font-semibold bg-slate-100 text-blue-600 hover:bg-blue-50 transition cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" /> Year
          </button>
        </div>

        {/* Income Inputs */}
        {!isMultiYear && (
        <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200/80 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Income</h2>
              <input
                type="number"
                min="0"
                value={currentPlan.year}
                onKeyDown={(e) => {
                  if (e.key === '-') e.preventDefault();
                }}
                onChange={(e) => handleYearChange(currentPlan.id, e.target.value)}
                aria-label="Plan Year"
                className="w-20 px-2.5 py-1 text-sm font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg text-center focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleCompChange('filingStatus', 'single')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  currentPlan.compensation.filingStatus === 'single'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => handleCompChange('filingStatus', 'married')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  currentPlan.compensation.filingStatus === 'married'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Married
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Salary / Yr
              </label>
              <EditableNumberInput
                prefix="$"
                step="1000"
                value={currentPlan.compensation.salary}
                onChange={(val) => handleCompChange('salary', val)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Bonus / Yr
              </label>
              <EditableNumberInput
                prefix="$"
                step="1000"
                value={currentPlan.compensation.bonus}
                onChange={(val) => handleCompChange('bonus', val)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Stock Options / Yr
              </label>
              <EditableNumberInput
                prefix="$"
                step="1000"
                value={currentPlan.compensation.stockOptions}
                onChange={(val) => handleCompChange('stockOptions', val)}
              />
            </div>
          </div>

          {/* Take-Home Strip */}
          <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <div className="text-xs text-slate-400">Monthly Salary</div>
                <div className="text-xl font-bold text-white">
                  ${formatMoney(monthlyNetSalary)}/mo
                </div>
              </div>

              <div className="h-8 w-px bg-slate-700 hidden sm:block" />

              <div>
                <div className="text-xs text-slate-400">Net Bonus</div>
                <div className="text-xl font-bold text-amber-400">
                  ${formatMoney(yearlyNetBonus)}/yr
                </div>
              </div>

              <div className="h-8 w-px bg-slate-700 hidden sm:block" />

              <div>
                <div className="text-xs text-slate-400">Total Yearly Take-Home</div>
                <div className="text-xl font-bold text-emerald-400">
                  ${formatMoney(yearlyNetTotal)}/yr
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowTaxDetails((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 px-3 py-2 rounded-lg cursor-pointer"
            >
              Taxes
              {showTaxDetails ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>

          {showTaxDetails && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Federal Tax</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  ${formatMoney(taxBreakdown.yearly.taxes.federalIncomeTax)}/yr
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">FICA</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  ${formatMoney(taxBreakdown.yearly.taxes.totalFicaTax)}/yr
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">WA Payroll</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  ${formatMoney(taxBreakdown.yearly.taxes.totalWaTax)}/yr
                </div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="text-emerald-700">WA Income Tax</div>
                <div className="text-sm font-bold text-emerald-900 mt-0.5">$0</div>
              </div>
            </div>
          )}
        </div>
        )}

        {/* View Switcher Bar */}
        {!isMultiYear && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex p-1.5 rounded-xl bg-white border border-slate-200 shadow-xs">
            <button
              type="button"
              onClick={() => setActiveTab('monthly')}
              className={`px-5 py-2 rounded-lg text-sm font-bold transition cursor-pointer ${
                isMonthly
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Monthly View
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('yearly')}
              className={`px-5 py-2 rounded-lg text-sm font-bold transition cursor-pointer ${
                !isMonthly
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Yearly View
            </button>
          </div>
        </div>
        )}

        {/* Multi-Year Savings & Investments View */}
        {isMultiYear && multiYearData && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200/80 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Multi-Year Savings & Investments ({multiYearData.startYearLabel} –{' '}
                    {multiYearData.endYearLabel})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Combined savings and investments across {multiYearData.yearCount}{' '}
                    {multiYearData.yearCount === 1 ? 'year' : 'years'} (Salary + Bonus +
                    Liquidatable Stock)
                  </p>
                </div>

                {sortedPlans.length > 1 && (
                  <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700">
                    <span className="text-slate-400 uppercase tracking-wider">
                      From
                    </span>
                    <select
                      aria-label="Start Year"
                      value={multiYearData.validStartId}
                      onChange={(e) => setRangeStartPlanId(e.target.value)}
                      className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 font-bold text-slate-900 focus:outline-none focus:border-blue-600 cursor-pointer"
                    >
                      {sortedPlans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.year || '----'}
                        </option>
                      ))}
                    </select>
                    <span className="text-slate-400 uppercase tracking-wider">
                      To
                    </span>
                    <select
                      aria-label="End Year"
                      value={multiYearData.validEndId}
                      onChange={(e) => setRangeEndPlanId(e.target.value)}
                      className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 font-bold text-slate-900 focus:outline-none focus:border-blue-600 cursor-pointer"
                    >
                      {sortedPlans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.year || '----'}
                        </option>
                      ))}
                    </select>
                    {(multiYearData.validStartId !== sortedPlans[0].id ||
                      multiYearData.validEndId !==
                        sortedPlans[sortedPlans.length - 1].id) && (
                      <button
                        type="button"
                        onClick={() => {
                          setRangeStartPlanId(sortedPlans[0].id);
                          setRangeEndPlanId(
                            sortedPlans[sortedPlans.length - 1].id
                          );
                        }}
                        className="ml-1 text-blue-600 hover:underline cursor-pointer"
                      >
                        All Years
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Top Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-violet-50/80 border border-violet-200">
                  <div className="text-xs font-bold text-violet-800">
                    Total Saved & Invested ({multiYearData.overallSavingsRate.toFixed(0)}%)
                  </div>
                  <div className="text-2xl font-bold text-violet-900 mt-1">
                    ${formatMoney(multiYearData.totalSaved)}
                  </div>
                  <div className="text-[11px] text-violet-700 mt-1">
                    Across {multiYearData.yearCount}{' '}
                    {multiYearData.yearCount === 1 ? 'year' : 'years'} (
                    {multiYearData.startYearLabel}–{multiYearData.endYearLabel})
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-blue-50/80 border border-blue-200">
                  <div className="text-xs font-bold text-blue-800">
                    Total Net Worth Added
                  </div>
                  <div className="text-2xl font-bold text-blue-900 mt-1">
                    ${formatMoney(multiYearData.totalNetWorth)}
                  </div>
                  <div className="text-[11px] text-blue-700 mt-1">
                    Includes ${formatMoney(multiYearData.totalLeftover)} unallocated leftover
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-xs font-medium text-slate-500">
                    Average Saved / Year
                  </div>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    $
                    {formatMoney(
                      multiYearData.yearCount > 0
                        ? multiYearData.totalSaved / multiYearData.yearCount
                        : 0
                    )}
                    /yr
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    ~$
                    {formatMoney(
                      multiYearData.yearCount > 0
                        ? multiYearData.totalSaved /
                            (multiYearData.yearCount * 12)
                        : 0
                    )}
                    /mo average
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
                  <div className="text-xs font-medium text-emerald-800">
                    Cumulative Net Take-Home
                  </div>
                  <div className="text-2xl font-bold text-emerald-900 mt-1">
                    ${formatMoney(multiYearData.totalTakeHome)}
                  </div>
                  <div className="text-[11px] text-emerald-700 mt-1">
                    Sal ${formatMoney(multiYearData.totalSalarySaved)} + Bon $
                    {formatMoney(multiYearData.totalBonusSaved)}
                    {multiYearData.totalLiquidStockSaved > 0
                      ? ` + Stk ${formatMoney(multiYearData.totalLiquidStockSaved)}`
                      : ''}{' '}
                    saved
                  </div>
                </div>
              </div>

              {/* Source Breakdown Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-900 text-white">
                <div className="p-3 rounded-lg bg-slate-800/80">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Salary Savings & Investments
                  </div>
                  <div className="text-lg font-bold text-white mt-0.5">
                    ${formatMoney(multiYearData.totalSalarySaved)}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {multiYearData.totalSaved > 0
                      ? (
                          (multiYearData.totalSalarySaved /
                            multiYearData.totalSaved) *
                          100
                        ).toFixed(0)
                      : 0}
                    % of total saved
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-800/80">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">
                    Bonus Savings & Investments
                  </div>
                  <div className="text-lg font-bold text-amber-300 mt-0.5">
                    ${formatMoney(multiYearData.totalBonusSaved)}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {multiYearData.totalSaved > 0
                      ? (
                          (multiYearData.totalBonusSaved /
                            multiYearData.totalSaved) *
                          100
                        ).toFixed(0)
                      : 0}
                    % of total saved
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-800/80">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-400">
                    Liquidatable Stock / Equity
                  </div>
                  <div className="text-lg font-bold text-indigo-300 mt-0.5">
                    ${formatMoney(multiYearData.totalLiquidStockSaved)}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {multiYearData.totalSaved > 0
                      ? (
                          (multiYearData.totalLiquidStockSaved /
                            multiYearData.totalSaved) *
                          100
                        ).toFixed(0)
                      : 0}
                    % of total saved
                    {multiYearData.totalUnliquidatedStock > 0
                      ? ` (${formatMoney(multiYearData.totalUnliquidatedStock)} unliquidated excluded)`
                      : ''}
                  </div>
                </div>
              </div>

              {/* Year-by-Year Progression Table */}
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
                  Year-by-Year Savings & Cumulative Progression
                </div>

                {multiYearData.perYearRows.map((row) => {
                  const barPct =
                    multiYearData.totalSaved > 0
                      ? Math.min(
                          100,
                          (row.cumulativeSaved / multiYearData.totalSaved) * 100
                        )
                      : 0;
                  return (
                    <div
                      key={row.id}
                      onClick={() => {
                        setActivePlanId(row.id);
                        setActiveMainView('planner');
                      }}
                      title={`Click to open ${row.year} in Budget Planner`}
                      className={`p-4 rounded-xl border transition cursor-pointer ${
                        row.id === currentPlan.id
                          ? 'bg-blue-50/40 border-blue-300'
                          : 'bg-slate-50 border-slate-200/80 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <span className="px-2.5 py-0.5 rounded-lg bg-slate-900 text-white text-xs font-bold">
                              {row.year}
                            </span>
                            <span className="font-bold text-slate-900">
                              +${formatMoney(row.yrSaved)} saved
                            </span>
                            <span className="text-xs font-semibold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
                              {row.yrSavingsRate.toFixed(0)}% of take-home
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1.5">
                            <span>
                              Salary Saved: ${formatMoney(row.yrSalarySaved)}
                            </span>
                            <span>•</span>
                            <span>
                              Bonus Saved: ${formatMoney(row.yrBonusSaved)}
                            </span>
                            {row.yrLiquidStock > 0 && (
                              <>
                                <span>•</span>
                                <span>
                                  Liquid Stock: ${formatMoney(row.yrLiquidStock)}
                                </span>
                              </>
                            )}
                            {!row.yrStockLiquidatable && row.yrGrossStock > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-amber-700">
                                  Unliquidated Stock ($
                                  {formatMoney(row.yrGrossStock)}) excluded
                                </span>
                              </>
                            )}
                            {row.yrLeftover > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-emerald-700">
                                  Leftover: +${formatMoney(row.yrLeftover)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="sm:text-right shrink-0">
                          <div className="text-xs text-slate-500">
                            Cumulative Saved through {row.year}
                          </div>
                          <div className="text-lg font-bold text-violet-800">
                            ${formatMoney(row.cumulativeSaved)}
                          </div>
                          <div className="text-[11px] font-medium text-blue-700">
                            Cumulative Net Worth: $
                            {formatMoney(row.cumulativeNetWorth)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full bg-violet-600 rounded-full transition-all"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Combined Savings & Investment Categories Breakdown */}
              {multiYearData.savedCategoryBreakdown.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
                    Combined Savings & Investments by Category (
                    {multiYearData.startYearLabel}–{multiYearData.endYearLabel})
                  </div>

                  <BudgetPieChart
                    items={multiYearData.savedCategoryBreakdown}
                    totalBase={multiYearData.totalSaved}
                  />

                  <div className="space-y-2.5">
                    {multiYearData.savedCategoryBreakdown.map((item) => {
                      const pct =
                        multiYearData.totalSaved > 0
                          ? (item.amount / multiYearData.totalSaved) * 100
                          : 0;
                      return (
                        <div
                          key={item.id}
                          className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className="w-3.5 h-3.5 rounded-full shrink-0"
                              style={{ backgroundColor: item.color }}
                            />
                            <div>
                              <div className="font-semibold text-slate-900">
                                {item.name}
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-0.5">
                                {item.salaryAmount > 0 && (
                                  <span>
                                    From Salary: ${formatMoney(item.salaryAmount)}
                                  </span>
                                )}
                                {item.bonusAmount > 0 && (
                                  <span>
                                    From Bonus: ${formatMoney(item.bonusAmount)}
                                  </span>
                                )}
                                {item.stockAmount > 0 && (
                                  <span>
                                    From Liquid Stock: $
                                    {formatMoney(item.stockAmount)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="sm:text-right">
                            <div className="text-base font-bold text-slate-900">
                              ${formatMoney(item.amount)}
                            </div>
                            <div className="text-xs font-medium text-slate-500">
                              {pct.toFixed(1)}% of total saved
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Salary Spending Card */}
        {!isMultiYear && (
        <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200/80 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">
              {isMonthly ? 'Monthly Salary Budget' : 'Yearly Salary Budget'}
            </h2>
            <button
              type="button"
              onClick={handleResetSalaryCategories}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>

          <div
            className={`grid grid-cols-1 ${
              isMonthly ? 'sm:grid-cols-3' : 'sm:grid-cols-4'
            } gap-4`}
          >
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs font-medium text-slate-500">Salary Take-Home</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                ${formatMoney(activeSalaryTakeHome)}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs font-medium text-slate-500">
                Spent ({activeSpentPercent.toFixed(0)}%)
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                ${formatMoney(activeSpent)}
              </div>
            </div>

            {!isMonthly && (
              <div className="p-4 rounded-xl bg-violet-50/70 border border-violet-200">
                <div className="text-xs font-medium text-violet-700">
                  Saved ({yearlySalarySavedPercent.toFixed(0)}%)
                </div>
                <div className="text-2xl font-bold text-violet-800 mt-1">
                  ${formatMoney(yearlySalarySaved)}
                </div>
              </div>
            )}

            <div
              className={`p-4 rounded-xl border ${
                activeLeftover >= 0
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : 'bg-red-50/70 border-red-200'
              }`}
            >
              <div
                className={`text-xs font-medium ${
                  activeLeftover >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {activeLeftover >= 0 ? 'Leftover' : 'Over'} (
                {Math.max(0, 100 - activeSpentPercent).toFixed(0)}%)
              </div>
              <div
                className={`text-2xl font-bold mt-1 ${
                  activeLeftover >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                ${formatMoney(activeLeftover)}
              </div>
            </div>
          </div>

          <BudgetPieChart
            items={salaryPieItems}
            totalBase={activeSalaryTakeHome}
          />

          <div className="space-y-3">
            {currentPlan.categories.map((cat) => {
              const monthlyAmt = Number(cat.monthlyAmount) || 0;
              const viewAmount = Math.round(
                isMonthly ? monthlyAmt : monthlyAmt * 12
              );
              const pct =
                activeSalaryTakeHome > 0
                  ? Math.round(((viewAmount / activeSalaryTakeHome) * 100) * 10) /
                    10
                  : 0;

              return (
                <div
                  key={cat.id}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-[180px]">
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <input
                      type="text"
                      value={cat.name}
                      onChange={(e) =>
                        handleCategoryNameChange(cat.id, e.target.value)
                      }
                      className="font-semibold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-600 focus:outline-none py-0.5 w-full"
                    />
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 flex-1 justify-end">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      disabled={Boolean(cat.locked)}
                      value={Math.min(100, pct)}
                      onChange={(e) =>
                        handleCategoryPercentChange(cat.id, e.target.value)
                      }
                      className={`w-full sm:w-32 ${
                        cat.locked ? 'opacity-40 cursor-not-allowed' : ''
                      }`}
                    />

                    <EditableNumberInput
                      prefix="$"
                      step={isMonthly ? '25' : '250'}
                      disabled={Boolean(cat.locked)}
                      value={viewAmount}
                      onChange={(val) => handleCategoryAmountChange(cat.id, val)}
                      className="w-32"
                    />

                    <EditableNumberInput
                      suffix="%"
                      step="1"
                      disabled={Boolean(cat.locked)}
                      value={pct}
                      onChange={(val) => handleCategoryPercentChange(cat.id, val)}
                      className="w-24"
                    />

                    <button
                      type="button"
                      onClick={() => handleToggleCategoryLock(cat.id)}
                      title={cat.locked ? 'Unlock category' : 'Lock category'}
                      className={`p-2 rounded-lg transition cursor-pointer ${
                        cat.locked
                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200/70'
                      }`}
                    >
                      {cat.locked ? (
                        <Lock className="w-4 h-4" />
                      ) : (
                        <Unlock className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={handleAddCategory}
            className="pt-2 flex flex-wrap items-center gap-3"
          >
            <input
              type="text"
              placeholder="New category..."
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="flex-1 min-w-[180px] bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20"
            />
            <EditableNumberInput
              suffix="%"
              value={newCategoryPercent}
              onChange={(val) => setNewCategoryPercent(String(val))}
              className="w-24"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </form>
        </div>
        )}

        {/* Yearly Bonus Split Section (Shown in Yearly Tab Only) */}
        {!isMultiYear && !isMonthly && (
          <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200/80 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                Yearly Bonus Split
              </h2>
              <button
                type="button"
                onClick={handleResetBonusCategories}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Bonus
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200">
                <div className="text-xs font-medium text-amber-800">
                  Bonus Take-Home
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-1">
                  ${formatMoney(yearlyNetBonus)}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-xs font-medium text-slate-500">
                  Allocated ({bonusSpentPercent.toFixed(0)}%)
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-1">
                  ${formatMoney(totalBonusSpent)}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-violet-50/70 border border-violet-200">
                <div className="text-xs font-medium text-violet-700">
                  Saved ({yearlyBonusSavedPercent.toFixed(0)}%)
                </div>
                <div className="text-2xl font-bold text-violet-800 mt-1">
                  ${formatMoney(yearlyBonusSaved)}
                </div>
              </div>

              <div
                className={`p-4 rounded-xl border ${
                  bonusLeftover >= 0
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : 'bg-red-50/70 border-red-200'
                }`}
              >
                <div
                  className={`text-xs font-medium ${
                    bonusLeftover >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {bonusLeftover >= 0 ? 'Leftover' : 'Over'} (
                  {Math.max(0, 100 - bonusSpentPercent).toFixed(0)}%)
                </div>
                <div
                  className={`text-2xl font-bold mt-1 ${
                    bonusLeftover >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  ${formatMoney(bonusLeftover)}
                </div>
              </div>
            </div>

            <BudgetPieChart items={bonusPieItems} totalBase={yearlyNetBonus} />

            <div className="space-y-3">
              {bonusCategories.map((cat) => {
                const yearlyAmt = Math.round(Number(cat.yearlyAmount) || 0);
                const pct =
                  yearlyNetBonus > 0
                    ? Math.round(((yearlyAmt / yearlyNetBonus) * 100) * 10) / 10
                    : 0;

                return (
                  <div
                    key={cat.id}
                    className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-[180px]">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      <input
                        type="text"
                        value={cat.name}
                        onChange={(e) =>
                          handleBonusNameChange(cat.id, e.target.value)
                        }
                        className="font-semibold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-600 focus:outline-none py-0.5 w-full"
                      />
                    </div>

                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 flex-1 justify-end">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        disabled={Boolean(cat.locked)}
                        value={Math.min(100, pct)}
                        onChange={(e) =>
                          handleBonusPercentChange(cat.id, e.target.value)
                        }
                        className={`w-full sm:w-32 ${
                          cat.locked ? 'opacity-40 cursor-not-allowed' : ''
                        }`}
                      />

                      <EditableNumberInput
                        prefix="$"
                        step="100"
                        disabled={Boolean(cat.locked)}
                        value={yearlyAmt}
                        onChange={(val) => handleBonusAmountChange(cat.id, val)}
                        className="w-32"
                      />

                      <EditableNumberInput
                        suffix="%"
                        step="1"
                        disabled={Boolean(cat.locked)}
                        value={pct}
                        onChange={(val) => handleBonusPercentChange(cat.id, val)}
                        className="w-24"
                      />

                      <button
                        type="button"
                        onClick={() => handleToggleBonusLock(cat.id)}
                        title={cat.locked ? 'Unlock category' : 'Lock category'}
                        className={`p-2 rounded-lg transition cursor-pointer ${
                          cat.locked
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                            : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200/70'
                        }`}
                      >
                        {cat.locked ? (
                          <Lock className="w-4 h-4" />
                        ) : (
                          <Unlock className="w-4 h-4" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteBonusCategory(cat.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <form
              onSubmit={handleAddBonusCategory}
              className="pt-2 flex flex-wrap items-center gap-3"
            >
              <input
                type="text"
                placeholder="New bonus category..."
                value={newBonusCatName}
                onChange={(e) => setNewBonusCatName(e.target.value)}
                className="flex-1 min-w-[180px] bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20"
              />
              <EditableNumberInput
                suffix="%"
                value={newBonusCatPercent}
                onChange={(val) => setNewBonusCatPercent(String(val))}
                className="w-24"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
