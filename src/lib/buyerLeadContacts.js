function cleanText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function splitContactValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => splitContactValues(item))
      .filter(Boolean);
  }

  const text = String(value).trim();
  if (!text) return [];

  return text
    .split(/[\n\r,;|/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizePhoneList(value) {
  const seen = new Set();
  const phones = [];
  for (const item of splitContactValues(value)) {
    const phone = cleanText(item);
    if (!phone) continue;
    const key = phone.replace(/[^\d+]/g, '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    phones.push(phone);
  }
  return phones;
}

function normalizeEmailList(value) {
  const seen = new Set();
  const emails = [];
  for (const item of splitContactValues(value)) {
    const email = cleanText(item);
    if (!email || !email.includes('@')) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return emails;
}

function toDbArray(list) {
  return list.length ? list : null;
}

module.exports = {
  cleanText,
  splitContactValues,
  normalizePhoneList,
  normalizeEmailList,
  toDbArray,
};
