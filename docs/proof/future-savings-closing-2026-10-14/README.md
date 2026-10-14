# Future Savings at period close

All numerical examples, fixtures and screenshots are invented. No provider
reads, household amounts, credentials or source documents enter this proof.

The outcome is a Forecast-owned closing Savings pot and chronological remaining
requirement allocation for the selected future pay period, if eligible surplus
is saved. Current reported allocation and the generic deadline-minimum funding
schedule retain their authorities.

On released main `73b73b2b22b2dee2b367a04ba386de201bbae5bd`, the final 15-case
acceptance specification fails 14 cases, with the existing outside-income-bound
control passing. Main has no closing-surplus publication. The earlier 11-case
initial specification failed all 11 cases before implementation.

## Independent numerical reconciliation

Opening Savings 119; next two native net surpluses 1,000 each; dated requirements
1,500 then 1,000. First close: 1,119 / 0. Second close: 1,500 / 619, total 2,119.
These literal cents were specified independently before the runtime change.
Per-period additions are 1,000 to the first requirement, then 381 / 619.

With an 80 goal expense between closes, the pot is 2,039; the paid goal leaves
only the projection. Operating 80 plus pot 2,039 equals initial household 199
plus income 2,000 less the 80 expense. It is not paid in canonical/current state.

With a later routine 20 deficit and only one 1,000 receipt, operating carry
80 becomes 60 while Savings stays 1,119. A 100 deficit instead limits the earlier
transfer to 960: operating 20, Savings 1,079. Savings never funds that routine
deficit and no loan is introduced. Bills and Household Budget deductions are
tested against their own literal net-surplus totals.

Current-tail tests distinguish proved Savings income, proved operating income,
missing receipt inclusion and unexplained reported increases. Only the existing
receipt/transfer/opening authority can supply a current-tail quota. Unknown
stock, pending movement, missing amounts/dates, missing receipts and unsupported
periods remain unknown. Typed closing packets reject malformed date, source,
permissions, currency, stock, items and actual-Saved promotions.

## Reproduction

`node --test test/test-savings-future-closing.js`

For red reproduction, set `ATLAS_TEST_APP_ROOT` to an isolated checkout of the
exact released main above and run the same current test file. Fixtures are
unchanged; only the producing Forecast revision changes.

`NODE_PATH=<existing Playwright runtime> CHROME_PATH=<Edge/Chromium> node test/browser-savings-future-closing.js`

The browser proof boots the real App and uses the visible river timeline via
keyboard navigation, both Savings renderers, real disclosures, back/forward
selection and rerender replacement at 1,440 / 390 / 320 pixels. GET responses are
intercepted invented data at one synthetic origin; outside requests, writes,
page errors and horizontal overflow fail. The output binds served source bytes
by SHA-256. A focused presentation fix removes the tile clipping class only
while future Savings evidence is in its dialog and restores it on close.

The source-bound browser receipt and screenshots will be added after the code
candidate is committed. Physical Safari and signed-in production acceptance,
owner figures look and exact-head Systems Review remain separate release work.
