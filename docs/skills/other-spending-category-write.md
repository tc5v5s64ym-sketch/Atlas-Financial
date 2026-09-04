# Other Spending category write

Use this only when maintaining the already-authorized Household Budget → Other
Spending manual `category_id` correction path.

The production seam must remain one exact current Other Spending transaction,
one existing Lunch Money category, one explicit authenticated confirmation,
and `category_id` only. Provider transaction IDs remain server-side. Refetch and
revalidate immediately before every write. Wait for provider confirmation, then
reload through the incumbent read overlay so Forecast recomputes; never mutate
published totals optimistically or keep a second transaction ledger.

This procedure does not authorize a broader write class. `ARCHITECTURE.md` and
the production-pass addendum remain authority.
