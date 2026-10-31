'use strict';
// Historical authority suites retain their original $800/$400 assertions.
// Select only the explicitly bounded retired configuration, without modifying
// canonical inputs or silently substituting it for an active-period fixture.
module.exports = source => {
 const data=JSON.parse(JSON.stringify(source));
 const other=data.plan.budget.categories.find(row=>row.id==='other-spend');
 const retired=other?.targetHistory?.find(row=>row.effectiveThrough==='2026-09-24');
 if(!retired || !(data.meta.asOf<=retired.effectiveThrough))throw new Error('Retired Other policy requires a bounded historical asOf');
 if(other.plannedPayday!==450 || other.targetEffectiveFrom!=='2026-09-25' || other.targetSource!=='owner-stated-2026-10-04')throw new Error('Missing approved dated Other restatement');
 Object.assign(other,retired);
 delete other.plannedPayday;delete other.targetEffectiveFrom;delete other.targetHistory;
 return data;
};
