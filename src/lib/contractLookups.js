function normalizeBuyingMode(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || /^(?:[-–—.|]+|NA|N\/A)$/i.test(trimmed)) return null;
  if (trimmed.toLowerCase() === 'bid/ra') return 'Bid/RA';
  return trimmed;
}

module.exports = { normalizeBuyingMode };
