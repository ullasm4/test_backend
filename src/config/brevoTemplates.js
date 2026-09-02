const env = require('@/config/env');

const BREVO_TEMPLATES = [
  {
    id: Number(env.BREVO_TEMPLATE_PEM_INVITATION || 2),
    key: 'pem_invitation',
    name: 'PEM Invitation',
    description: 'Default invitation to join Private E-Marketplace (PEM)',
    param_keys: ['company_name'],
  },
  {
    id: Number(env.BREVO_TEMPLATE_SELLER_OUTREACH || 4),
    key: 'seller_outreach',
    name: 'Seller Outreach',
    description:
      'Personalized outreach with company name, contract value, categories, and sender contact',
    param_keys: [
      'company_name',
      'total_contract_value',
      'categories',
      'person_name',
      'person_phone',
    ],
  },
];

function getBrevoTemplateById(templateId) {
  const id = Number(templateId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return BREVO_TEMPLATES.find((template) => template.id === id) || null;
}

function isSellerOutreachTemplate(templateId) {
  const template = getBrevoTemplateById(templateId);
  return template?.key === 'seller_outreach';
}

module.exports = {
  BREVO_TEMPLATES,
  getBrevoTemplateById,
  isSellerOutreachTemplate,
};
