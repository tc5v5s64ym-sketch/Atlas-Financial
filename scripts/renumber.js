// Renumber the dashboard's <h2> section markers sequentially after edits.
const fs = require('fs');
const p = process.argv[2];
let h = fs.readFileSync(p, 'utf8');
let i = 0;
h = h.replace(/<h2><span class="n">\d+<\/span>/g, () => `<h2><span class="n">${++i}</span>`);
fs.writeFileSync(p, h);
console.log(`renumbered ${i} sections`);
for (const m of h.match(/<h2>[\s\S]*?<\/h2>/g) || []) {
  console.log('  ' + m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
