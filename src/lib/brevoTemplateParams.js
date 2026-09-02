const MAX_OUTREACH_CATEGORIES = 5;

function toBrevoParam(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function formatContractValueForBrevo(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'not available';
  }
  return `₹ ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCategoriesForBrevo(categories) {
  const cleaned = (Array.isArray(categories) ? categories : [])
    .map((category) => String(category || '').trim())
    .filter(Boolean);

  if (!cleaned.length) {
    return 'your registered product and service categories';
  }

  const visible = cleaned.slice(0, MAX_OUTREACH_CATEGORIES);
  return visible.join(', ');
}

/**
 * Builds params for Brevo template #4 (seller outreach).
 * Template placeholders: {{ params.company_name }}, {{ params.total_contract_value }},
 * {{ params.categories }}, {{ params.person_name }}, {{ params.person_phone }}
 */
function buildSellerOutreachParams({ companyName, seller, sender, categories }) {
  return {
    company_name: toBrevoParam(companyName),
    total_contract_value: formatContractValueForBrevo(seller?.total_value),
    categories: formatCategoriesForBrevo(categories),
    person_name: toBrevoParam(sender?.personName),
    person_phone: toBrevoParam(sender?.personPhone),
  };
}

function buildPemInvitationParams({ companyName, to, subject }) {
  const company = toBrevoParam(companyName);
  return {
    company_name: company,
    COMPANY_NAME: company,
    RECIPIENT_EMAIL: toBrevoParam(to),
    SUBJECT: toBrevoParam(subject),
  };
}

function buildBrevoTemplateParams({ templateKey, companyName, to, finalSubject, seller, sender, categories }) {
  if (templateKey === 'seller_outreach') {
    return buildSellerOutreachParams({ companyName, seller, sender, categories });
  }

  return buildPemInvitationParams({ companyName, to, subject: finalSubject });
}

function getDefaultSubjectForTemplate(templateKey) {
  if (templateKey === 'seller_outreach') {
    return 'Invitation to join Private E-Marketplace (PEM)';
  }

  return 'Invitation to join Portal: Private E-Marketplace (PEM)';
}

module.exports = {
  MAX_OUTREACH_CATEGORIES,
  formatContractValueForBrevo,
  formatCategoriesForBrevo,
  buildSellerOutreachParams,
  buildPemInvitationParams,
  buildBrevoTemplateParams,
  getDefaultSubjectForTemplate,
  toBrevoParam,
};
