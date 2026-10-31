// Loads machine-local account identifiers so they never appear in tracked code.
// local-config.json is gitignored; copy local-config.example.json to create it.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'local-config.json');
if (!fs.existsSync(file)) {
  console.error('Missing scripts/local-config.json — copy local-config.example.json and fill it in.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));

const heloc = cfg.helocAccountFragment;
if (!heloc) {
  console.error('local-config.json is missing helocAccountFragment.');
  process.exit(1);
}

module.exports = {
  heloc,
  helocPaymentPrefix: cfg.helocPaymentPrefix || '',
  // Regexes the analysis scripts use to recognise HELOC movements.
  reDraw: new RegExp(`TFR-FR ${heloc}`),
  rePay: new RegExp(`TFR-TO ${heloc}|PYT TO: *${cfg.helocPaymentPrefix || ''}${heloc}`),
};
