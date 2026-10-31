'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),Review=require('../public/transaction-review');
const source={status:'available-complete',count:1,items:[{date:'2026-08-20',amount:18.25,account:'chequing-a',pending:false,
 id:'tx-1',coverageRef:'pc-secret',providerTransactionId:'private-provider-id',notes:'rent settled fuel',payee:'private payee'}]};
const before=JSON.stringify(source);
const html=Review.html(source,{current:true});
assert.match(html,/What was this transfer for/);assert.match(html,/\$18\.25/);
assert.match(html,/Bills account/);assert.match(html,/Aug 20, 2026/);
assert.doesNotMatch(html,/private|pc-secret|tx-1|rent settled fuel|data-review-save|<input|<select|<textarea/);
assert.match(html,/total number of owner questions is unavailable/i);
assert.match(html,/Purchase and payment match/);
assert.match(html,/would not prove bill settlement/);
assert.equal(JSON.stringify(source),before);
for(const status of['unavailable-stale','unavailable-missing','alien']){
 const output=Review.html({...source,status},{current:true});assert.doesNotMatch(output,/data-review-item|\$18\.25/);
 assert.match(output,/cannot be confirmed/i);
}
assert.doesNotMatch(Review.html(source,{current:false}),/data-review-item|\$18\.25/);
for(const status of['available-posted-only','available-incomplete']){
 const output=Review.html({...source,status},{current:true});assert.match(output,/observed subset|coverage is incomplete/);assert.match(output,/\$18\.25/);
}
for(const amount of[null,undefined,'18.25',NaN,Infinity,-1]){
 assert.match(Review.html({...source,items:[{...source.items[0],amount}]},{current:true}),/Amount unavailable/);
}
const injected=Review.html({...source,items:[{date:'2026-02-30',account:'<svg onload=evil>',amount:0,pending:null}]},{current:true});
assert.match(injected,/Date unavailable/);assert.match(injected,/Account unavailable/);assert.match(injected,/Unconfirmed/);assert.doesNotMatch(injected,/onload/);
const main=fs.readFileSync(require('node:path').join(__dirname,'../public/transaction-review.js'),'utf8');
assert.doesNotMatch(main,/\bfetch\s*\(|localStorage|sessionStorage|Forecast\.|JSON\.parse|providerTransactionId\s*:/);
console.log('PASS transaction review: read-only whitelist, current-period gate, no inferred purpose/settlement, no fabricated shared question count or writes');
