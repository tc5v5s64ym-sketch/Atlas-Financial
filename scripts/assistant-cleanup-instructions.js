'use strict';
// Reusable preview data, never standing authorization or a provider rule.
const z = require('zod/v4');
const text = z.string().min(1).max(200).refine(v => v.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(v));
const note = z.string().min(1).max(500).refine(v => v.trim().length > 0
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
const account = z.object({ name: text, type: z.enum(['plaid', 'manual']) }).strict();
const recipeChanges = z.object({ payee: text.optional(), categoryName: text.optional(),
  notesAppend: note.optional(), tagNamesAdd: z.array(text).min(1).max(20).optional(),
  transferLabel: z.object({ from: account, to: account }).strict().optional(),
}).strict().refine(v => Object.keys(v).length > 0 && !(v.payee && v.transferLabel)
  && (!v.tagNamesAdd || new Set(v.tagNamesAdd).size === v.tagNamesAdd.length));
const schema = z.object({ schema: z.literal('atlas-lunchmoney-cleanup-instruction/v1'),
  name: text, changes: recipeChanges }).strict();
const createSchema = z.object({ name: text, changes: recipeChanges }).strict();
function create(input) {
  return { status: 'instruction', instruction: { schema: 'atlas-lunchmoney-cleanup-instruction/v1', ...input },
    providerWrite: false, writesAtlasState: false, automaticEdits: false,
    usage: 'Keep this instruction as reusable data. Pass it to prepare_lunchmoney_edit with one freshly looked-up transactionRef. Exact current catalog names must be unique. Show the fresh before/proposed preview and confirm it individually. This instruction creates no rule, grant, schedule or automatic access.' };
}
function unique(rows, matches) {
  const found = rows.filter(matches);
  if (found.length !== 1) throw new Error('cleanup-catalog-match-not-unique');
  return found[0];
}
function resolve(instruction, catalog) {
  const source = instruction.changes, result = {};
  for (const key of ['payee', 'notesAppend']) if (source[key] !== undefined) result[key] = source[key];
  if (source.categoryName !== undefined) result.categoryRef = unique(catalog.categories,
    row => row.name === source.categoryName && !row.archived && !row.group).categoryRef;
  if (source.tagNamesAdd) result.tagRefsAdd = source.tagNamesAdd.map(name =>
    unique(catalog.tags, row => row.name === name && !row.archived).tagRef);
  if (source.transferLabel) {
    const accountRef = spec => unique(catalog.accounts,
      row => row.name === spec.name && row.type === spec.type).accountRef;
    result.transferLabel = { fromAccountRef: accountRef(source.transferLabel.from),
      toAccountRef: accountRef(source.transferLabel.to) };
  }
  return result;
}
module.exports = { text, note, schema, createSchema, create, resolve };
