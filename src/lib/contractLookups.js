function normalizeBuyingMode(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || /^(?:[-–—.|]+|NA|N\/A)$/i.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'bid/ra' || lower === 'bid' || lower === 'ra' || /bid\s*\/\s*ra/i.test(trimmed)) {
    return 'Bid/RA';
  }
  if (lower === 'direct' || /direct/i.test(trimmed)) return 'Direct';
  return trimmed;
}

/** Prefer PDF Procurement Mode; else Bid/RA if bid_number present, else Direct. */
function deriveBuyingMode(bidNumber, procurementMode) {
  const fromProc = normalizeBuyingMode(procurementMode);
  if (fromProc === 'Bid/RA' || fromProc === 'Direct') return fromProc;
  const bid = String(bidNumber ?? '').trim();
  if (bid && !/^(?:[-–—.|]+|NA|N\/A)$/i.test(bid)) return 'Bid/RA';
  return 'Direct';
}

module.exports = { normalizeBuyingMode, deriveBuyingMode };
