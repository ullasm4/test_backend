/**
 * Parse GeM contract PDF text into structured sections.
 *
 * Supports:
 *   - simple:     "Company Name: FORCE MOTORS"
 *   - bilingual:  "Company Name|कंपनी का नाम : FORCE MOTORS"
 *   - split-line: "Payment Mode|\nभुगतान का तरीका: Offline"
 *   - double colon: "Brand|ब्रांड :: Force Motors Ltd"
 */

function cleanVal(v) {
  let s = String(v ?? '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[:|,.\-–—\s]+/, '')
    .replace(/[:|,.\-–—\s]+$/, '')
    .trim();
  if (!s) return '';
  if (/^(?:[-–—.|]+|NA|N\/A|nil|null|none|--)$/i.test(s)) return '';
  return s;
}

function isExplicitEmpty(raw) {
  return /^(?:[-–—.|]+|NA|N\/A|--)?$/i.test(String(raw ?? '').trim());
}

function sectionBetween(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start < 0) return '';
  const rest = text.slice(start);
  const endMatch = rest.slice(1).search(endRe);
  if (endMatch >= 0) return rest.slice(0, endMatch + 1);
  return rest;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NEXT_LABEL =
  '(?:GeM Seller ID|Company Name|Contact No|Email ID|Email|GSTIN|MSME|MSE |Designation|Role|Payment Mode|IFD Concurrence|Name|Address|Product Name|Brand Type|Brand|Model|HSN|Catalogue Status|Selling As|Category Name|Organisation|Organization|Ministry|Department|Type|Office Zone|Buyer Details|Seller Details|Financial|Paying|Consignee|Delivery Instructions|\\*GST|Item Description|S\\.No|Lot No|Quantity|Generated Date|Contract No)';

/**
 * Pick a labeled value from a section.
 */
function pickLabeled(section, labels, { multiline = false, kind = '' } = {}) {
  const names = (Array.isArray(labels) ? labels : [labels])
    .map((l) => String(l).trim())
    .filter(Boolean);
  if (!section || !names.length) return '';

  for (const label of names) {
    const esc = escapeRe(label);

    // Multiline address first when requested
    if (multiline) {
      const multiRe = new RegExp(
        `${esc}\\s*(?:\\|[^\\n:]*)?\\s*::?\\s*([\\s\\S]*?)(?=\\n\\s*${NEXT_LABEL}|$)`,
        'i'
      );
      const mm = section.match(multiRe);
      if (mm) {
        const val = cleanVal(mm[1].replace(/\n+/g, ' '));
        if (val) return sanitizeByKind(val, kind);
      }
    }

    // Same line: Label|hindi :: value  OR  Label: value
    const sameLine = new RegExp(
      `${esc}\\s*(?:\\|[^\\n:]*)?\\s*::?\\s*([^\\n]+)`,
      'i'
    );
    const sm = section.match(sameLine);
    if (sm) {
      if (isExplicitEmpty(sm[1])) return '';
      const val = cleanVal(sm[1]);
      if (val) {
        const ok = sanitizeByKind(val, kind);
        if (ok) return ok;
        // wrong kind (e.g. address grabbed as phone) → try other strategies
      }
    }

    // Split line: "Label|" then next line has "hindi: VALUE"
    const splitRe = new RegExp(
      `${esc}\\s*(?:\\|[^\\n]*)?\\s*(?:\\n)\\s*([^\\n]+)`,
      'i'
    );
    const sp = section.match(splitRe);
    if (sp) {
      const firstLine = sp[1];
      if (isExplicitEmpty(firstLine)) return '';
      const afterColon = firstLine.match(/::?\s*(.+)\s*$/);
      const candidate = afterColon ? afterColon[1] : firstLine;
      if (isExplicitEmpty(candidate)) return '';
      const val = cleanVal(candidate);
      if (val) {
        const ok = sanitizeByKind(val, kind);
        if (ok) return ok;
      }
    }
  }
  return '';
}

function sanitizeByKind(val, kind) {
  if (!val) return '';
  if (kind === 'email') {
    const m = val.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0] : '';
  }
  if (kind === 'phone') {
    const m = val.replace(/[^\d+]/g, '');
    if (m.replace(/\D/g, '').length >= 8) return cleanVal(val.replace(/[^\d+\-/\s]/g, ''));
    return '';
  }
  if (kind === 'gstin') {
    const m = val.match(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/i);
    return m ? m[0].toUpperCase() : '';
  }
  if (kind === 'seller_id') {
    const m = val.match(/\b[A-Z0-9]{10,20}\b/);
    return m ? m[0] : cleanVal(val);
  }
  // reject values that look like another field's content leaked
  if (/^(?:National Centre|Force Motors|Room No)/i.test(val) && kind === 'designation') {
    return '';
  }
  return val;
}

function pickField(section, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  for (const re of list) {
    if (!re) continue;
    const m = section.match(re);
    if (m && cleanVal(m[1])) return cleanVal(m[1]);
  }
  return '';
}

function parseProducts(productSec) {
  const products = [];
  if (!productSec) return products;

  const blocks = productSec.split(/(?=Product Name\s*(?:\||:))/i).slice(1);
  for (const block of blocks) {
    if (!/Product Name/i.test(block)) continue;

    const product_name = pickLabeled(block, ['Product Name', 'Item Description']);
    let brand = pickLabeled(block, ['Brand']);
    if (brand && /Brand Type/i.test(brand)) {
      brand = cleanVal(brand.split(/Brand Type/i)[0]);
    }
    const model = pickLabeled(block, ['Model']);
    const hsn_code = pickLabeled(block, ['HSN Code']);

    const qtyPrice = block.match(
      /(\d+)\s+pieces\s+[\d.%]+\s+([\d,]+(?:\.\d+)?)\s+\S+\s+([\d,]+(?:\.\d+)?)/i
    );
    const quantity = qtyPrice ? qtyPrice[1] : pickField(block, [/(\d+)\s+pieces/i]);
    const unit_price = qtyPrice
      ? qtyPrice[3].replace(/,/g, '')
      : '';

    if (!product_name && !brand && !model && !quantity) continue;

    products.push({
      product_name: product_name || '',
      brand: brand || '',
      brand_type: pickLabeled(block, ['Brand Type']),
      catalogue_status: pickLabeled(block, ['Catalogue Status']),
      selling_as: pickLabeled(block, ['Selling As']),
      category: pickLabeled(block, ['Category Name & Quadrant', 'Category Name']),
      model: model || '',
      hsn_code: hsn_code || '',
      quantity: quantity || '',
      unit_price: unit_price || '',
    });
  }

  if (!products.length) {
    const rowRe =
      /^\s*(\d+)\s+(.+?)\s+(\d+)\s+pieces\s+([\d,]+(?:\.\d+)?)\s*$/gim;
    let m;
    while ((m = rowRe.exec(productSec)) !== null) {
      products.push({
        product_name: cleanVal(m[2]),
        brand: '',
        model: '',
        hsn_code: '',
        quantity: m[3],
        unit_price: m[4].replace(/,/g, ''),
      });
    }
  }

  return products;
}

function cleanConsigneeAddress(address) {
  if (!address) return '';
  let a = String(address);
  a = a.replace(
    /\s+(?:Force Motors|Product Name|Vehicles?\s*\(|Manual Two|Konica|Digital Multifunctional|HP \d|OEM Cartridge|Class OEM|Brand\b)[\s\S]*$/i,
    ''
  );
  a = a.replace(/\s+[-–—]?\s*\d+\s+\d{2}-[A-Za-z]{3}-\d{4}[\s\S]*$/i, '');
  a = a.replace(/\s+\d{2,4}\s+\d+\s+\d{2}-[A-Za-z]{3}-\d{4}[\s\S]*$/i, '');
  const indiaPin = a.match(/^([\s\S]*?\bIndia\b)/i);
  if (indiaPin) a = indiaPin[1];
  return cleanVal(a);
}

/**
 * GeM PDFs have TWO "Consignee" areas:
 *  1) Person block: Name / Email / Address  (what we want)
 *  2) "Consignee Detail" product table     (NOT person info)
 */
function extractConsigneePersonBlock(raw) {
  const text = String(raw || '');

  // Layout A: labeled Name/Designation/Email/Address (+ a few lines for qty/dates)
  const labeledLoose = text.match(
    /Name:\s*[^\n]+\n(?:Designation:\s*[^\n]*\n)?(?:Email ID:\s*[^\n]+\n)?(?:Contact:\s*[^\n]*\n)?(?:GSTIN:\s*[^\n]*\n)?Address:\s*[\s\S]*?\bIndia\b(?:[^\n]*\n){0,3}[^\n]*/i
  );
  if (labeledLoose) return labeledLoose[0];

  // Layout B: "Consignee Item ..." unstructured person lines
  const tableIdx = text.search(/Consignee\s+Item(?:\s+Lot|\s+Quantity)/i);
  if (tableIdx >= 0) {
    let chunk = text.slice(tableIdx);
    const endAt = chunk.search(
      /\nConsignee Detail\b|\nProduct Details\b|\nSeller Details\b|\n#\s*Item\b/i
    );
    if (endAt > 0) chunk = chunk.slice(0, endAt);
    else chunk = chunk.slice(0, 900);
    return chunk;
  }

  // Layout C: bilingual Consignee Detail with Designation/Email
  const bilingualIdx = text.search(/Consignee Detail\s*(?:\||)/i);
  if (bilingualIdx >= 0) {
    let chunk = text.slice(bilingualIdx);
    const endAt = chunk.search(
      /\nProduct Specification\b|\nePBG Detail\b|\nTerms and Conditions\b|\nSeller Details\b/i
    );
    if (endAt > 0) chunk = chunk.slice(0, endAt);
    if (
      /Email ID\s*(?:\||:)|Designation\s*(?:\||:)/i.test(chunk) &&
      !/#\s*Item Description/i.test(chunk.slice(0, 200))
    ) {
      return chunk;
    }
  }

  return '';
}

function parseConsignee(rawText) {
  const safeSec = extractConsigneePersonBlock(rawText) || '';
  if (!safeSec) {
    return {
      name: '',
      designation: '',
      email: '',
      contact: '',
      gstin: '',
      address: '',
      quantity: '',
      delivery_start_after: '',
      delivery_to_be_completed_by: '',
    };
  }

  let name = pickLabeled(safeSec, ['Name']);
  let designation = pickLabeled(safeSec, ['Designation'], { kind: 'designation' });
  let email = pickLabeled(safeSec, ['Email ID', 'Email'], { kind: 'email' });
  let contact = pickLabeled(safeSec, ['Contact No.', 'Contact No', 'Contact', 'Landline'], {
    kind: 'phone',
  });
  let gstin = pickLabeled(safeSec, ['GSTIN'], { kind: 'gstin' });
  let address = cleanConsigneeAddress(
    pickLabeled(safeSec, ['Address'], { multiline: true })
  );

  if (
    name &&
    /lot|quantity|item|price|model|hsn|description|category|ordered|मा|लॉट|नंबर|परे/i.test(name)
  ) {
    name = '';
  }
  if (name && !/^[A-Za-z][A-Za-z .'-]{1,80}$/.test(name)) name = '';

  if (!email || !name || !address) {
    const emailMatch = safeSec.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (!email && emailMatch) email = emailMatch[0];

    const lines = safeSec
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter(
        (l) =>
          !/Consignee\s+Item|Consignee Detail|S\.No|Expected Delivery|Delivery Start|Delivery To|Lot\s*No|#\s*Item|Quantity Unit|Price\s*\(/i.test(
            l
          ) &&
          !/Seller Details|Company Name|GeM Seller|Product Details|Product Name/i.test(l) &&
          !/^[-–—.\d\s]+$/.test(l)
      );

    if (!name) {
      const nameLine = lines.find(
        (l) =>
          !/@/.test(l) &&
          !/^(?:Name|Designation|Email|Contact|GSTIN|Address|Landline)\b/i.test(l) &&
          !/Secretary|Officer|Director|Manager|Engineer|Room|Floor|India|BANGALORE|PUNE|KARNATAKA|Vidhana|Soudha|Maharashtra|Telescope|Metrewave|Khodad|Narayangaon/i.test(
            l
          ) &&
          !/Konica|Cartridge|Toner|OEM|Multifunctional|Vehicles|Manual Two|Force Motors|Utility|Class OEM|Drive\(/i.test(
            l
          ) &&
          /^[A-Za-z][A-Za-z .'-]{1,60}$/.test(l) &&
          l.split(/\s+/).length <= 5
      );
      if (nameLine) name = cleanVal(nameLine);
    }

    if (!designation) {
      const desigLine = lines.find((l) =>
        /^(?:Under Secretary|Deputy Secretary|Secretary|Officer|Director|Manager|Engineer|AOB|AAB|AOC)\b/i.test(
          l
        )
      );
      if (desigLine) designation = cleanVal(desigLine);
    }

    if (!address) {
      const addrLines = [];
      let collecting = false;
      for (const l of lines) {
        if (/^Address:/i.test(l) || /Room No|Vidhana|At\/Post|Floor,/i.test(l)) collecting = true;
        if (!collecting) continue;
        if (/Konica|Cartridge|Toner|OEM|^\d+\s+\d+\s+\d{2}-[A-Za-z]/i.test(l)) break;
        addrLines.push(l.replace(/^Address:\s*/i, ''));
        if (/\bIndia\b/i.test(l)) break;
      }
      if (addrLines.length) address = cleanConsigneeAddress(addrLines.join(' '));
    }

    if (!contact) {
      const land = safeSec.match(/Landline\s*[-–—:]*\s*([\d+\-\s\/]{8,})?/i);
      if (land && land[1]) contact = cleanVal(land[1]);
    }
  }

  let quantity = '';
  let delivery_start_after = '';
  let delivery_to_be_completed_by = '';

  const dashQty = safeSec.match(
    /[-–—]\s*(\d+)\s+(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{2}-[A-Za-z]{3}-\d{4})/
  );
  const twoDates = safeSec.match(
    /(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{2}-[A-Za-z]{3}-\d{4})/
  );
  const oneDateQty = safeSec.match(/\b(\d+)\s+(\d{2}-[A-Za-z]{3}-\d{4})\b/);

  if (dashQty) {
    quantity = dashQty[1];
    delivery_start_after = dashQty[2];
    delivery_to_be_completed_by = dashQty[3];
  } else if (twoDates) {
    delivery_start_after = twoDates[1];
    delivery_to_be_completed_by = twoDates[2];
    const q = safeSec.match(/[-–—]\s*(\d+)\s+\d{2}-[A-Za-z]{3}-\d{4}/);
    if (q) quantity = q[1];
  } else if (oneDateQty) {
    quantity = oneDateQty[1];
    delivery_start_after = oneDateQty[2];
  }

  return {
    name: name || '',
    designation: designation || '',
    email: email || '',
    contact: contact || '',
    gstin: gstin || '',
    address: address || '',
    quantity: quantity || '',
    delivery_start_after: delivery_start_after || '',
    delivery_to_be_completed_by: delivery_to_be_completed_by || '',
  };
}

function parsePdfSections(text) {
  const raw = String(text || '');

  const orgSec = sectionBetween(
    raw,
    /Organisation Details|Organization Details/i,
    /Buyer Details|Seller Details|Financial Approval Detail|Paying Authority Details|Product Details|Consignee Detail|Terms and Conditions|Generated Date|Contract No/i
  );
  const buyerSec = sectionBetween(
    raw,
    /Buyer Details/i,
    /Financial Approval Detail|Paying Authority Details|Seller Details|Organisation Details|Organization Details|Product Details|Consignee Detail|Terms and Conditions/i
  );
  const financialSec = sectionBetween(
    raw,
    /Financial Approval Detail/i,
    /Paying Authority Details|Seller Details|Buyer Details|Organisation Details|Organization Details|Product Details|Consignee Detail|Terms and Conditions/i
  );
  const payingSec = sectionBetween(
    raw,
    /Paying Authority Details/i,
    /Seller Details|Buyer Details|Product Details|Consignee Detail|Organisation Details|Organization Details|Terms and Conditions/i
  );
  const sellerSec = sectionBetween(
    raw,
    /Seller Details/i,
    /Financial Approval Detail|Paying Authority Details|Buyer Details|Product Details|Consignee Detail|Organisation Details|Organization Details|\*GST|Delivery Instructions|Terms and Conditions/i
  );
  const productSec = sectionBetween(
    raw,
    /Product Details/i,
    /Consignee Detail|Seller Details|Buyer Details|Financial Approval Detail|Product Specification|Terms and Conditions|ePBG Detail/i
  );

  // Delivery instructions often between seller and products
  const deliverySec = sectionBetween(
    raw,
    /Delivery Instructions/i,
    /Product Details|Consignee Detail|Terms and Conditions/i
  );

  const contract_number = pickField(raw, [
    /Contract No\s*(?:\||:)[^\n]*?::?\s*(GEMC-\d+)/i,
    /(GEMC-\d+)/,
  ]);
  const generated_date = pickLabeled(raw, ['Generated Date']);

  const organisation_details = {
    type: pickLabeled(orgSec, ['Type']),
    ministry: pickLabeled(orgSec, ['Ministry']),
    department: pickLabeled(orgSec, ['Department']),
    organisation_name: pickLabeled(orgSec, [
      'Organisation Name',
      'Organization Name',
    ]),
    office_zone: pickLabeled(orgSec, ['Office Zone']),
  };

  const buyer_details = {
    name: pickLabeled(buyerSec, ['Name']),
    designation: pickLabeled(buyerSec, ['Designation'], { kind: 'designation' }),
    contact_no: pickLabeled(buyerSec, ['Contact No.', 'Contact No', 'Contact'], {
      kind: 'phone',
    }),
    email: pickLabeled(buyerSec, ['Email ID', 'Email'], { kind: 'email' }),
    gstin: pickLabeled(buyerSec, ['GSTIN'], { kind: 'gstin' }),
    address: pickLabeled(buyerSec, ['Address'], { multiline: true }),
  };

  const financial_application = {
    ifd_concurrence: pickLabeled(financialSec, ['IFD Concurrence']),
    administrative_approval_designation: pickLabeled(financialSec, [
      'Designation of Administrative Approval',
    ]),
    financial_approval_designation: pickLabeled(financialSec, [
      'Designation of Financial Approval',
    ]),
  };

  const paying_authority = {
    role: pickLabeled(payingSec, ['Role']),
    payment_mode: pickLabeled(payingSec, ['Payment Mode']),
    designation: pickLabeled(payingSec, ['Designation'], { kind: 'designation' }),
    email: pickLabeled(payingSec, ['Email ID', 'Email'], { kind: 'email' }),
    gstin: pickLabeled(payingSec, ['GSTIN'], { kind: 'gstin' }),
    address: pickLabeled(payingSec, ['Address'], { multiline: true }),
  };

  const seller_details = {
    seller_id: pickLabeled(sellerSec, ['GeM Seller ID', 'Seller ID'], {
      kind: 'seller_id',
    }),
    company_name: pickLabeled(sellerSec, ['Company Name']),
    contact_no: pickLabeled(sellerSec, ['Contact No.', 'Contact No', 'Contact'], {
      kind: 'phone',
    }),
    email: pickLabeled(sellerSec, ['Email ID', 'Email'], { kind: 'email' }),
    address: pickLabeled(sellerSec, ['Address'], { multiline: true }),
    msme_certificate_number: pickLabeled(sellerSec, [
      'MSME Registration number',
      'MSME Registration Number',
    ]),
    gst_number: pickLabeled(sellerSec, ['GSTIN'], { kind: 'gstin' }),
    delivery_instructions: cleanVal(
      (deliverySec || '')
        .replace(/^Delivery Instructions\s*(?:\||:)[^\n]*::?\s*/i, '')
        .replace(/\n+/g, ' ')
    ),
  };

  const products = parseProducts(productSec);
  const consinee_details = parseConsignee(raw);

  return {
    contract_number,
    generated_date,
    organisation_details,
    buyer_details,
    financial_application,
    paying_authority,
    seller_details,
    products,
    consinee_details,
  };
}

module.exports = { parsePdfSections, cleanVal, pickLabeled };
