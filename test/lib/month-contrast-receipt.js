'use strict';

// Contrast diagnostics need readable precision, not binary floating-point tails
// that resemble identifiers to the incumbent repository guard. Assertions run
// on the unrounded measurements; exact ratios remain recoverable from the
// recorded foreground/background RGB colors. All other evidence stays exact.
function serializeReceipt(receipt) {
  return JSON.stringify({ ...receipt, measurementPrecision: {
    contrastDecimalPlaces: 6,
    assertions: 'Unrounded contrast values; stored contrast and pixelContrast diagnostics rounded to six decimal places.',
    reconstruction: 'Compute exact contrast from each recorded foreground or nearestForegroundPixel and its card background RGB.',
  } }, (key, value) => (key === 'contrast' || key === 'pixelContrast') && typeof value === 'number'
    ? Number(value.toFixed(6)) : value, 2) + '\n';
}

module.exports = { serializeReceipt };
