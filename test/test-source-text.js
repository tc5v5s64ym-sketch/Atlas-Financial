'use strict';
/* B88 — checkout line-ending independence for source-inspection tests.
 *
 * Call this at the test input boundary when newline identity is not the
 * contract being proved. It does not touch product files, Git attributes,
 * or emitted bytes. `\r\n` and lone `\r` become `\n`; LF is unchanged.
 */
function sourceText(input) {
  return String(input).replace(/\r\n?/g, '\n');
}

module.exports = { sourceText };
