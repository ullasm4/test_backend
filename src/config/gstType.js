/** GSTIN 4th character = PAN entity type (3rd char of PAN). */
const GST_TYPES = Object.freeze(['C', 'P', 'H', 'F', 'A', 'T', 'B', 'L', 'J', 'G']);

const GST_TYPE_LABELS = Object.freeze({
  C: 'Company',
  P: 'Individual / Person',
  H: 'HUF',
  F: 'Firm / Partnership',
  A: 'AOP',
  T: 'Trust',
  B: 'BOI',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government',
});

module.exports = {
  GST_TYPES,
  GST_TYPE_LABELS,
};
