'use strict';
// An independent legacy locale oracle: reuse formatter objects, never results.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const f = vm.runInNewContext(source.slice(0, source.indexOf('// Household YYYY-MM-DD only.'))
  + '\n({money2,fmtDate,fmtDateLong,fmtDateFull})');
const plan = fs.readFileSync(path.join(__dirname, '../public/plan.js'), 'utf8');
const p = vm.runInNewContext(plan.slice(plan.indexOf('const addDays ='), plan.indexOf('/* --------------------------------------------------- the mission'))
  + '\n({fmtMonth,fmtRange})');
for (const value of [0, -0, 1.005, 1234567.89, -987654.32, '1200.40', null, undefined, NaN, Infinity, -Infinity]) {
  const expected = (value < 0 ? '−$' : '$') + Math.abs(Number(value)).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.equal(f.money2(value), expected);
}
for (const iso of ['2026-01-01', '2026-03-08', '2026-08-14', '2026-11-01', '2026-12-31', '2027-01-01', 'unavailable', '', null]) {
  assert.equal(p.fmtMonth(iso), new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', {month:'long'}));
  for (const [name, options] of [['fmtDate', {day:'numeric',month:'short'}], ['fmtDateLong', {day:'numeric',month:'long'}], ['fmtDateFull', {day:'numeric',month:'long',year:'numeric'}]]) {
    assert.equal(f[name](iso), new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', options));
  }
}
for (const [a,b] of [['2026-08-14','2026-08-27'],['2026-08-28','2026-09-10'],['2026-12-25','2027-01-07'],['unavailable','']]) {
  const s=new Date(a+'T00:00:00'),e=new Date(b+'T00:00:00');
  const sm=s.toLocaleDateString('en-CA',{month:'short'}),em=e.toLocaleDateString('en-CA',{month:'short'});
  assert.equal(p.fmtRange(a,b),sm===em?`${s.getDate()}–${e.getDate()} ${em}`:`${s.getDate()} ${sm} – ${e.getDate()} ${em}`);
}
console.log('PASS selector locale formatting: exact legacy cents, signs, unknowns, local dates, year boundaries and invalid dates');
