# Knowledge-Evidence Register

**Owner of:** whether an *explicitly identified* external-reference claim —
general, domain, or institution-published knowledge that is not a household
fact — is recorded with the provenance and freshness a reader needs before
relying on it, and which Atlas explanation surface it may inform.

**Not the owner of:** household facts, balances, rates, limits, dates or terms
of any household account; Forecast inputs or outputs; owner policy; transaction
or provider evidence; financial permission; or any independently sufficient
authority for a household financial calculation or action. Forecast remains
the sole household calculator.

The live register is [`register.json`](register.json). It mirrors the shape
and conventions of [`../evidence_use/register.json`](../evidence_use/register.json):
one JSON file under `docs/`, provider-neutral, one row per explicitly
identified ID, no second store.

## One trust class: `external-reference`

A record here is a claim about the world outside the household — an
institution's published process, a market convention, a rule of thumb. Its
content class is `general`, `domain`, or `external`. It never carries the
verified / calculated / estimated / unknown household trust tags, because it is
not household data.

Every record keeps:

- **provenance** — when it was researched, how, and each source with its
  publisher, kind (`institution-published` or `third-party-commentary`) and URL;
- **freshness** — when it was checked, a `review_by` date, and why a re-check is
  needed; after `review_by` the claim needs re-checking and is not current;
- **may_inform** — the existing `docs/` surface it may inform, by path and
  heading; and
- **is_not** — the closed exclusion list: `household-fact`, `forecast-input`,
  `forecast-output`, `owner-policy`, `transaction-evidence`,
  `provider-evidence`, `financial-permission`, `sufficient-authority`.

## Informs explanation only

A record may later inform an explanation of an already-published Atlas or
Forecast result. It is never a Forecast input, never a published figure, never
owner policy, and never permission to act. `may_inform` paths stay under
`docs/`; `data.json`, `public/forecast.js`, and the assistant packet are not
consumers of this register.

## Coverage is explicit IDs only

CI proves record shape, provenance, freshness, informs pointers and the
exclusion list for the IDs recorded in `register.json`. It does not verify a
claim against the institution, and it does not read Markdown and decide what is
material. IDs match `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]{3}$` and must not
collide with an Evidence-Use Register ID or appear in an `evidence-ids` fence.

This folder is an index over sourced external knowledge. It is not a sixth
architectural layer, a fact store, a second `ACCOUNT_FACTS.md`, or a second
roadmap.
