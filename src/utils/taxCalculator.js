// Federal & Washington State Tax Calculator (2025/2026 Tax Rules)

const STANDARD_DEDUCTION = {
  single: 15000,
  married: 30000,
};

const FEDERAL_BRACKETS = {
  single: [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 626350, rate: 0.35 },
    { min: 626350, max: Infinity, rate: 0.37 },
  ],
  married: [
    { min: 0, max: 23850, rate: 0.10 },
    { min: 23850, max: 96950, rate: 0.12 },
    { min: 96950, max: 206700, rate: 0.22 },
    { min: 206700, max: 394600, rate: 0.24 },
    { min: 394600, max: 501050, rate: 0.32 },
    { min: 501050, max: 751600, rate: 0.35 },
    { min: 751600, max: Infinity, rate: 0.37 },
  ],
};

const SS_WAGE_CAP = 176100;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDL_MEDICARE_RATE = 0.009;
const ADDL_MEDICARE_THRESHOLD = {
  single: 200000,
  married: 250000,
};

// Washington State Payroll Taxes (0% State Income Tax)
const WA_CARES_LTC_RATE = 0.0058; // 0.58% uncapped on gross wages
const WA_PFML_EMPLOYEE_RATE = 0.00528; // ~0.528% employee portion (capped at SS wage cap)

export function computeTaxesForGross(grossIncome, filingStatus = 'single') {
  const gross = Math.max(0, Number(grossIncome) || 0);
  const status = filingStatus === 'married' ? 'married' : 'single';

  const standardDeduction = STANDARD_DEDUCTION[status];
  const taxableIncome = Math.max(0, gross - standardDeduction);

  // Progressive Federal Income Tax
  let federalIncomeTax = 0;
  let marginalRate = 0.10;
  for (const bracket of FEDERAL_BRACKETS[status]) {
    if (taxableIncome > bracket.min) {
      const taxableInBracket = Math.min(taxableIncome, bracket.max) - bracket.min;
      federalIncomeTax += taxableInBracket * bracket.rate;
      marginalRate = bracket.rate;
    }
  }

  // FICA Taxes
  const socialSecurityTax = Math.min(gross, SS_WAGE_CAP) * SS_RATE;
  const baseMedicareTax = gross * MEDICARE_RATE;
  const addlMedicareTax =
    Math.max(0, gross - ADDL_MEDICARE_THRESHOLD[status]) * ADDL_MEDICARE_RATE;
  const medicareTax = baseMedicareTax + addlMedicareTax;
  const totalFicaTax = socialSecurityTax + medicareTax;

  // Washington State Taxes
  const waStateIncomeTax = 0; // WA has 0% state income tax
  const waPfmlTax = Math.min(gross, SS_WAGE_CAP) * WA_PFML_EMPLOYEE_RATE;
  const waCaresTax = gross * WA_CARES_LTC_RATE;
  const totalWaTax = waStateIncomeTax + waPfmlTax + waCaresTax;

  const totalTax = federalIncomeTax + totalFicaTax + totalWaTax;
  const netPay = Math.max(0, gross - totalTax);
  const effectiveTaxRate = gross > 0 ? (totalTax / gross) * 100 : 0;

  return {
    gross,
    taxableIncome,
    standardDeduction,
    federalIncomeTax,
    socialSecurityTax,
    medicareTax,
    totalFicaTax,
    waStateIncomeTax,
    waPfmlTax,
    waCaresTax,
    totalWaTax,
    totalTax,
    netPay,
    effectiveTaxRate,
    marginalRate: marginalRate * 100,
  };
}

export function calculateCompensationBreakdown({
  salary = 0,
  bonus = 0,
  stockOptions = 0,
  filingStatus = 'single',
}) {
  const cleanSalary = Math.max(0, Number(salary) || 0);
  const cleanBonus = Math.max(0, Number(bonus) || 0);
  const cleanStock = Math.max(0, Number(stockOptions) || 0);
  const totalGrossYearly = cleanSalary + cleanBonus + cleanStock;

  // 1. Base Salary Only (used for Monthly View take-home pay)
  const salaryOnlyTaxes = computeTaxesForGross(cleanSalary, filingStatus);
  const monthlySalaryGross = cleanSalary / 12;
  const monthlySalaryTax = salaryOnlyTaxes.totalTax / 12;
  const monthlySalaryNet = salaryOnlyTaxes.netPay / 12;

  // 2. Salary + Bonus (to isolate bonus vs stock net impact)
  const salaryPlusBonusTaxes = computeTaxesForGross(
    cleanSalary + cleanBonus,
    filingStatus
  );

  // 3. Full Yearly Compensation (Salary + Bonus + Stock Options)
  const yearlyTotalTaxes = computeTaxesForGross(totalGrossYearly, filingStatus);

  const bonusNetYearly = Math.max(
    0,
    salaryPlusBonusTaxes.netPay - salaryOnlyTaxes.netPay
  );
  const stockNetYearly = Math.max(
    0,
    yearlyTotalTaxes.netPay - salaryPlusBonusTaxes.netPay
  );

  return {
    inputs: {
      salary: cleanSalary,
      bonus: cleanBonus,
      stockOptions: cleanStock,
      filingStatus,
    },
    monthly: {
      grossSalary: monthlySalaryGross,
      totalTax: monthlySalaryTax,
      netSalaryTakeHome: monthlySalaryNet,
      federalIncomeTax: salaryOnlyTaxes.federalIncomeTax / 12,
      ficaTax: salaryOnlyTaxes.totalFicaTax / 12,
      waTax: salaryOnlyTaxes.totalWaTax / 12,
      effectiveTaxRate: salaryOnlyTaxes.effectiveTaxRate,
    },
    yearly: {
      grossTotal: totalGrossYearly,
      grossSalary: cleanSalary,
      grossBonus: cleanBonus,
      grossStock: cleanStock,
      netTotalTakeHome: yearlyTotalTaxes.netPay,
      netSalary: salaryOnlyTaxes.netPay,
      netBonus: bonusNetYearly,
      netStock: stockNetYearly,
      taxes: yearlyTotalTaxes,
      salaryOnlyTaxes,
    },
  };
}
