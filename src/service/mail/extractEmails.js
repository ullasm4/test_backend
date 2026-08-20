const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isValidEmail(value) {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

/**
 * Extract unique email addresses from brand_info.brand_email JSONB.
 * Supports: string[], { label, value }[], or { label: value } objects.
 */
function extractEmailsFromBrandEmail(brandEmail) {
  if (!brandEmail) return [];

  const emails = [];

  const pushEmail = (raw) => {
    const email = normalizeEmail(raw);
    if (email && isValidEmail(email) && !emails.includes(email)) {
      emails.push(email);
    }
  };

  if (Array.isArray(brandEmail)) {
    for (const item of brandEmail) {
      if (typeof item === 'string') {
        pushEmail(item);
      } else if (item && typeof item === 'object') {
        pushEmail(item.value ?? item.email ?? item.address);
      }
    }
    return emails;
  }

  if (typeof brandEmail === 'object') {
    for (const value of Object.values(brandEmail)) {
      if (typeof value === 'string') {
        pushEmail(value);
      } else if (value && typeof value === 'object') {
        pushEmail(value.value ?? value.email ?? value.address);
      }
    }
  }

  return emails;
}

module.exports = {
  extractEmailsFromBrandEmail,
  isValidEmail,
  normalizeEmail,
};
