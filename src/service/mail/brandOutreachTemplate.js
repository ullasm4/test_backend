const DEFAULT_MAIL_TYPE = 'pem_outreach';

const DEFAULT_TEMPLATE = {
  mail_type: DEFAULT_MAIL_TYPE,
  name: 'PEM Seller Outreach',
  description:
    'Default invitation email sent to join Portal: Private E-Marketplace.',
  subject: 'Invitation to join Portal: Private E-Marketplace (PEM)',
  body: [
    'Dear Team,',
    '',
    'Greetings from Private E-Marketplace (PEM).',
    '',
    'I hope you are doing well.',
    '',
    'We are pleased to introduce Private E-Marketplace (PEM), a modern procurement platform designed to connect buyers and sellers through a secure, transparent, and efficient digital marketplace.',
    '',
    'In Private E-Marketplace, private organizations can create tenders and carry out procurement online.',
    '',
    'We look forward to welcoming you to the Private E-Marketplace portal.',
    '',
    'Best Regards,',
    '{{sender_name}}',
    'Portal: {{sender_website}}',
  ].join('\n'),
  sender_name: 'Private E-Marketplace',
  sender_website: 'pem.co.in',
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeWebsiteUrl(website) {
  const raw = String(website || '').trim() || 'pem.co.in';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, '')}`;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHtmlLink(href, label) {
  const safeHref = escapeHtml(normalizeWebsiteUrl(href));
  const safeLabel = escapeHtml(label);
  return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
}

function applyInlineMarkdown(escapedText, website) {
  let result = String(escapedText || '');
  const websiteUrl = normalizeWebsiteUrl(website);
  const websiteHost = websiteUrl.replace(/^https?:\/\//i, '');

  // Markdown links: [label](https://example.com)
  result = result.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi,
    (_, label, href) => buildHtmlLink(href, label),
  );

  // "Private E-Marketplace (PEM)" → link to sender website
  result = result.replace(
    /Private\s+E-?Marketplace\s*\(PEM\)/gi,
    (match) => buildHtmlLink(websiteUrl, match),
  );

  // Bold: **text**
  result = result.replace(
    /\*\*(.+?)\*\*/g,
    (_, inner) => `<strong>${inner}</strong>`,
  );

  // Bare sender website text → clickable link (avoid matching inside href=...)
  if (websiteHost) {
    result = result.replace(
      new RegExp(`(^|[\\s(])(${escapeRegExp(websiteHost)})(?=$|[\\s).,!?])`, 'gi'),
      (_, prefix, host) => `${prefix}${buildHtmlLink(websiteUrl, host)}`,
    );
  }

  return result;
}

function normalizeCategoryLabels(categoryLabels) {
  if (!Array.isArray(categoryLabels)) {
    const single = String(categoryLabels || '').trim();
    return single ? [single] : [];
  }

  const labels = [];
  for (const item of categoryLabels) {
    const label = String(item || '').trim();
    if (!label || labels.includes(label)) continue;
    labels.push(label);
  }
  return labels;
}

function formatCategoryLines(categories) {
  const labels = normalizeCategoryLabels(categories);
  if (!labels.length) return ['• GeM marketplace'];

  const maxVisible = 10;
  if (labels.length <= maxVisible) {
    return labels.map((name) => `• ${name}`);
  }

  const visible = labels.slice(0, maxVisible);
  const remaining = labels.length - maxVisible;
  return [
    ...visible.map((name) => `• ${name}`),
    `• ... and ${remaining} more categor${remaining === 1 ? 'y' : 'ies'}`,
  ];
}

function replacePlaceholders(template, values) {
  const company = String(values.company || '').trim() || 'your company';
  const brand = String(values.brand || '').trim() || company;
  const replacements = {
    company,
    brand,
    sender_name:
      String(values.sender_name || '').trim() || 'Private E-Marketplace',
    sender_website:
      String(values.sender_website || '').trim() || 'pem.co.in',
    categories: formatCategoryLines(values.categories).join('\n'),
  };

  return String(template || '').replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (match, key) =>
      Object.prototype.hasOwnProperty.call(replacements, key)
        ? replacements[key]
        : match,
  );
}

function templateBodyToHtml(body, options = {}) {
  const website = options.website || 'pem.co.in';
  const lines = String(body || '').split('\n');
  const parts = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const html = paragraph
      .map((line) => applyInlineMarkdown(escapeHtml(line), website))
      .join('<br />\n');
    paragraph = [];
    parts.push(`<p>${html}</p>`);
  };

  for (const rawLine of lines) {
    const trimmed = String(rawLine || '').trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (/^•\s+/.test(trimmed) || /^-\s+/.test(trimmed)) {
      flushParagraph();
      const label = trimmed.replace(/^([•\-]\s+)/, '');
      const item = `<li><strong>${escapeHtml(label)}</strong></li>`;
      const prev = parts[parts.length - 1];
      if (prev && prev.startsWith('<ul>') && prev.endsWith('</ul>')) {
        parts[parts.length - 1] = `${prev.slice(0, -5)}${item}</ul>`;
      } else {
        parts.push(`<ul>${item}</ul>`);
      }
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return parts.join('\n');
}

/**
 * Split plain-text body into main content + trailing "Best Regards" signature lines.
 */
function extractSignatureFromBody(body) {
  const lines = String(body || '').split('\n');
  let signatureIndex = -1;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^best\s*regards,?$/i.test(String(lines[i] || '').trim())) {
      signatureIndex = i;
      break;
    }
  }

  if (signatureIndex < 0) {
    return { mainBody: String(body || ''), signatureLines: null };
  }

  let cutAt = signatureIndex;
  while (cutAt > 0 && !String(lines[cutAt - 1] || '').trim()) {
    cutAt -= 1;
  }

  const signatureLines = lines
    .slice(signatureIndex)
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  return {
    mainBody: lines.slice(0, cutAt).join('\n').replace(/\s+$/, ''),
    signatureLines,
  };
}

/**
 * Signature text block for the email footer.
 */
function buildSignatureRowHtml(signatureLines, website = 'pem.co.in') {
  const lines = Array.isArray(signatureLines) && signatureLines.length
    ? signatureLines
    : ['Best Regards,', 'Private E-Marketplace', 'pem.co.in'];

  const textHtml = lines
    .map((line) => applyInlineMarkdown(escapeHtml(line), website))
    .join('<br />\n');

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border-collapse:collapse;">',
    '<tr>',
    `<td style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111111;">${textHtml}</td>`,
    '</tr>',
    '</table>',
  ].join('');
}

/**
 * Append signature footer to outreach HTML body.
 */
function withBrandOutreachLogo(html, options = {}) {
  const website = options.website || 'pem.co.in';
  let body = String(html || '').trim();

  let signatureLines = Array.isArray(options.signatureLines)
    ? options.signatureLines
    : null;

  if (!signatureLines) {
    const match = body.match(
      /<p>((?:(?!<\/p>)[\s\S])*Best\s*Regards,?[\s\S]*?)<\/p>\s*$/i,
    );
    if (match) {
      signatureLines = match[1]
        .split(/<br\s*\/?>/i)
        .map((part) =>
          String(part || '')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim(),
        )
        .filter(Boolean);
      body = body.slice(0, match.index).trim();
    }
  }

  const signatureHtml = buildSignatureRowHtml(signatureLines, website);
  return body ? `${body}\n${signatureHtml}` : signatureHtml;
}

/**
 * Convert outreach body to HTML with signature footer.
 */
function buildBrandOutreachHtml(body, options = {}) {
  const website = options.website || 'pem.co.in';
  const { mainBody, signatureLines } = extractSignatureFromBody(body);
  const mainHtml = templateBodyToHtml(mainBody, { website });
  return withBrandOutreachLogo(mainHtml, { website, signatureLines });
}

/**
 * Build PEM seller outreach mail from the hardcoded DEFAULT_TEMPLATE.
 * Placeholders: {{company}}, {{brand}}, {{categories}}, {{sender_name}}, {{sender_website}}
 * Bold: wrap text in **like this**
 * "Private e Marketplace (PEM)" becomes a link to sender_website in HTML.
 */
function buildBrandOutreachMail({
  brandLabel,
  categoryLabel,
  categoryLabels,
  companyName,
  template,
}) {
  const source = template || DEFAULT_TEMPLATE;
  const brand = String(brandLabel || '').trim() || 'your brand';
  const company = String(companyName || '').trim() || brand;
  const categories = normalizeCategoryLabels(
    categoryLabels?.length ? categoryLabels : categoryLabel,
  );

  const values = {
    company,
    brand,
    categories,
    sender_name: source.sender_name,
    sender_website: source.sender_website,
  };

  const subject = replacePlaceholders(source.subject, values);
  const body = replacePlaceholders(source.body, values);
  const html = buildBrandOutreachHtml(body, {
    website: source.sender_website,
  });

  return {
    mailType: source.mail_type || DEFAULT_MAIL_TYPE,
    subject,
    body,
    html,
    attachments: [],
  };
}

module.exports = {
  DEFAULT_MAIL_TYPE,
  DEFAULT_TEMPLATE,
  buildBrandOutreachMail,
  replacePlaceholders,
  templateBodyToHtml,
  buildBrandOutreachHtml,
  withBrandOutreachLogo,
  escapeHtml,
};
