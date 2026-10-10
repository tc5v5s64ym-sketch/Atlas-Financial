'use strict';
// Historical authority suites retain their explicitly bounded $325 policy.
// Active and future 555 behavior is proved in test-fuel-effective-target.js.
module.exports = source => {
  const data = JSON.parse(JSON.stringify(source));
  const fuel = data.plan.budget.categories.find(row => row.id === 'fuel');
  const retired = fuel?.targetHistory?.find(row => row.effectiveThrough === '2026-10-08');
  if (!retired || !(data.meta.asOf <= retired.effectiveThrough)) {
    throw new Error('Retired Fuel policy requires a bounded historical asOf');
  }
  if (fuel.plannedPayday !== 555 || fuel.targetEffectiveFrom !== '2026-10-09'
      || fuel.targetSource !== 'owner-stated-2026-10-10') {
    throw new Error('Missing approved dated Fuel restatement');
  }
  Object.assign(fuel, retired);
  delete fuel.targetEffectiveFrom;
  delete fuel.targetHistory;
  return data;
};
