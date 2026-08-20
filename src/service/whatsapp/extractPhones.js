const MOBILE_PHONE_PATTERN = /^[6-9]\d{9}$/;

function normalizeIndianPhoneDigits(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let digits = String(value).replace(/\D/g, '');

  if (digits.length === 13 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }

  if (digits.length === 12 && digits.startsWith('0')) {
    digits = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return digits;
}

function isValidMobileDigits(digits) {
  return MOBILE_PHONE_PATTERN.test(digits);
}

function toWhatsAppDestination(value, countryCode = '91') {
  const digits = normalizeIndianPhoneDigits(value);
  if (!isValidMobileDigits(digits)) return '';
  return `${countryCode}${digits}`;
}

module.exports = {
  normalizeIndianPhoneDigits,
  isValidMobileDigits,
  toWhatsAppDestination,
};
