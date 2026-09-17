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

/** "1,625.573" / "1625.573" → "1625.573" */
function parseMoney(v) {
  const s = String(v ?? '').replace(/,/g, '').trim();
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : '';
}

/** Strip duplicated label prefixes: "Brand : Krone" → "Krone" */
function stripFieldLabel(v, labels) {
  let s = cleanVal(v);
  if (!s) return '';
  const list = Array.isArray(labels) ? labels : [labels];
  for (const label of list) {
    if (!label) continue;
    s = s.replace(new RegExp(`^${escapeRe(label)}\\s*:\\s*`, 'i'), '').trim();
  }
  return cleanVal(s);
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
  '(?:GeM Seller ID|Company Name|Contact No|Email ID|Email|GSTIN|MSME|MSE |Designation|Role|Payment Mode|IFD Concurrence|Name|Address|Product Name|Brand Type|Brand|Model|HSN|Catalogue Status|Selling As|Category Name|Organisation|Organization|Ministry|Department|Type|Office Zone|Buyer Details|Seller Details|Service Provider Details|Service Details|Financial|Paying|Consignee|Delivery Instructions|\\*GST|Item Description|S\\.No|Lot No|Quantity|Generated Date|Contract No|Billing Cycle|Service Start|Service End)';

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
    let brand = stripFieldLabel(pickLabeled(block, ['Brand']), ['Brand']);
    if (brand && /Brand Type/i.test(brand)) {
      brand = cleanVal(brand.split(/Brand Type/i)[0]);
    }
    const model = stripFieldLabel(pickLabeled(block, ['Model']), ['Model']);
    const hsn_code = stripFieldLabel(pickLabeled(block, ['HSN Code']), ['HSN Code']);

    // Rows: "6 pieces 270.929 NA 1,625.573" (qty, unit price, tax, line total)
    const qtyPrice = block.match(
      /(\d+)\s+pieces\s+([\d,]+(?:\.\d+)?)\s+(?:[\d,]+(?:\.\d+)?|NA|-)\s+([\d,]+(?:\.\d+)?)/i
    );
    const quantity = qtyPrice ? qtyPrice[1] : pickField(block, [/(\d+)\s+pieces/i]);
    const unit_price = qtyPrice ? parseMoney(qtyPrice[2]) : '';
    const line_total = qtyPrice ? parseMoney(qtyPrice[3]) : '';

    if (!product_name && !brand && !model && !quantity) continue;

    products.push({
      product_name: product_name || '',
      brand: brand || '',
      brand_type: stripFieldLabel(pickLabeled(block, ['Brand Type']), ['Brand Type']),
      catalogue_status: stripFieldLabel(pickLabeled(block, ['Catalogue Status']), [
        'Catalogue Status',
      ]),
      selling_as: stripFieldLabel(pickLabeled(block, ['Selling As']), ['Selling As']),
      category: stripFieldLabel(
        pickLabeled(block, ['Category Name & Quadrant', 'Category Name']),
        ['Category Name & Quadrant', 'Category Name']
      ),
      model: model || '',
      hsn_code: hsn_code || '',
      quantity: quantity || '',
      unit_price: unit_price || '',
      ...(line_total ? { line_total } : {}),
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
        unit_price: parseMoney(m[4]),
      });
    }
  }

  return products;
}

/**
 * GeM service contracts use "Service Details" instead of "Product Details".
 * Extract category / qty / contract total into the same products[] shape.
 */
function parseServiceDetails(serviceSec, rawText) {
  const products = [];
  const sec = String(serviceSec || '');
  if (!sec && !rawText) return products;

  const category =
    pickLabeled(sec, ['Category Name & Quadrant', 'Category Name']) ||
    pickField(rawText || sec, [
      /Category Name\s*(?:\||:)[^\n]*::?\s*([^\n|]+)/i,
    ]);
  const categoryClean = cleanVal(String(category || '').split(/\|/)[0]);

  const description = pickLabeled(sec, ['Description', 'Service Description']);

  let quantity =
    pickLabeled(sec, ['Quantity', 'Number of Thali/Packet/Plate required per Day']) ||
    '';
  if (!quantity) {
    const qtyMatch = (rawText || sec).match(
      /Number of Thali\/Packet\/Plate required per Day[^\d]*(\d{1,7})/i
    );
    if (qtyMatch) quantity = qtyMatch[1];
  }

  const unit_price =
    pickLabeled(sec, ['Cost per Thali/ Packets/ Plates', 'Cost per Thali/Packets/Plates']) ||
    '';

  const totalFromLabels =
    pickField(rawText || sec, [
      /Total Contract Value Including All Duties and Taxes\s*\(INR\)\s*(?:\||:)?\s*([\d,]+(?:\.\d+)?)/i,
      /Total Value Including Addons\s*\(INR\)\s*(?:\||:)?\s*([\d,]+(?:\.\d+)?)/i,
      /Total Value without Addons\s*\(INR\)\s*(?:\||:)?\s*([\d,]+(?:\.\d+)?)/i,
      /Amount of Contract[^\d]*([\d,]+(?:\.\d+)?)/i,
    ]) || '';

  const total_value = String(totalFromLabels || unit_price || '').replace(/,/g, '');
  const product_name = cleanVal(categoryClean || description);
  if (!product_name && !quantity && !total_value) return products;

  const startDate =
    pickField(sec, [
      /Service Start Date\s*(?:\(latest by\))?\s*(?:\||:)?\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
    ]) || '';
  const endDate =
    pickField(sec, [
      /Service End Date\s*(?:\||:)?\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
    ]) || '';
  const billing =
    pickField(sec, [/Billing Cycle\s*(?:\||:)?\s*([A-Za-z]+)/i]) ||
    cleanVal(pickLabeled(sec, ['Billing Cycle']).split(/\|/)[0]);

  products.push({
    product_name: product_name || 'Service',
    brand: '',
    brand_type: '',
    catalogue_status: '',
    selling_as: '',
    category: categoryClean || '',
    model: '',
    hsn_code: '',
    quantity: quantity || '',
    unit_price: total_value || unit_price || '',
    service_start_date: startDate,
    service_end_date: endDate,
    billing_cycle: billing,
  });

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
  return cleanPdfAddress(a);
}

/** Trim GeM bilingual bleed (next-section Hindi/labels) from address values. */
function cleanPdfAddress(address) {
  if (!address) return '';
  let a = String(address);
  a = a.replace(
    /\s*(?:एमएसएमई|जीएसट|एमएसई|\*?\s*जिसके|परे|वित्तीय|संगठन|खरीदार|सेवा\s*प्रदाता|सेवा\s*विवरण).*$/i,
    ''
  );
  a = a.replace(
    /\s*(?:MSME Registration|GSTIN\s*:|MSE Social|MSE Gender|GST\s*\/\s*Tax invoice|Financial Approval|Paying Authority|Consignee Details?|Service Provider|Service Details|Seller Details|Buyer Details|Organisation Details|Product Details).*$/i,
    ''
  );
  // Drop trailing Devanagari / mojibake after a completed address
  a = a.replace(/\s+[\u0900-\u097F!][\u0900-\u097F\s!<>]{2,}.*$/u, '');
  const indiaPin = a.match(/^([\s\S]*?\bIndia\b)/i);
  if (indiaPin) a = indiaPin[1];
  // Service-provider addresses often end with state + PIN, no "India"
  a = a.replace(/\s*[-–—]\s*$/, '');
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
      /\nConsignee Detail\b|\nProduct Details\b|\nService Details\b|\nService Provider Details\b|\nSeller Details\b|\n#\s*Item\b/i
    );
    if (endAt > 0) chunk = chunk.slice(0, endAt);
    else chunk = chunk.slice(0, 900);
    return chunk;
  }

  // Layout C: bilingual Consignee Detail(s) with Designation/Email/Address
  const bilingualIdx = text.search(/Consignee Details?\s*(?:\||)/i);
  if (bilingualIdx >= 0) {
    let chunk = text.slice(bilingualIdx);
    // GeM often puts Hindi on the same line: "...|Service Provider Details"
    const endAt = chunk.search(
      /Service Provider Details\b|Seller Details\b|Service Details\b|Product Specification\b|ePBG Detail\b|Terms and Conditions\b|SLA Details\b/i
    );
    if (endAt > 0) chunk = chunk.slice(0, endAt);
    if (
      /Email ID\s*(?:\||:)|Designation\s*(?:\||:)|Address\s*(?:\||:)/i.test(chunk) &&
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
    /lot|quantity|item|price|model|hsn|description|category|ordered|मा|लॉट|नंबर|परे|caterers|ltd|pvt|private|company|ashapuri/i.test(
      name
    )
  ) {
    name = '';
  }
  if (name && !/^[A-Za-z][A-Za-z .'-]{1,80}$/.test(name)) name = '';

  // Service-table PDFs often have no person name — designation/email/address is enough
  if (!name && /Consignee Name & Address|Service Description/i.test(safeSec)) {
    name = '';
  }
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

  // Service contracts: "... Regular Packet  900" (qty at end of description line)
  if (!quantity) {
    const serviceQty = safeSec.match(
      /(?:Regular|Special|Mini)?\s*(?:Packet|Thali|Buffet|Plate)[^\n]*?\s+(\d{2,7})\s*$/im
    );
    if (serviceQty) quantity = serviceQty[1];
  }
  if (!quantity) {
    const qtyCol = safeSec.match(
      /Quantity\s*(?:\||[^\n]*)?\s*\n[\s\S]*?\bIndia\b[^\n]*\n[^\n]*?\s+(\d{1,7})\s*$/im
    );
    if (qtyCol) quantity = qtyCol[1];
  }
  // Never treat S.No "1" alone as quantity when a larger service qty exists nearby.
  // Do not steal a phone-extension fragment (e.g. "01475-242002, 242048").
  if (quantity === '1') {
    const bigger = safeSec.match(/\b(\d{2,7})\s*$/m);
    if (bigger) {
      const lineStart = safeSec.lastIndexOf('\n', bigger.index) + 1;
      const line = safeSec.slice(lineStart, bigger.index + bigger[0].length);
      const phoneLike =
        /(?:phone|contact|landline)/i.test(line) ||
        /\d{4,}[-–]\d{3,}/.test(line);
      if (!phoneLike) quantity = bigger[1];
    }
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

function moneyTokens(s) {
  return [...String(s || '').matchAll(/[\d,]+(?:\.\d+)?/g)]
    .map((m) => Number(String(m[0]).replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 1e16);
}

/** Money after the last copy of a bilingual label on the same line. */
function moneyAfterLastLabel(line, labelRe) {
  const re = new RegExp(labelRe.source, 'gi');
  let lastEnd = -1;
  let m;
  while ((m = re.exec(line))) lastEnd = m.index + m[0].length;
  if (lastEnd < 0) return null;
  const tokens = moneyTokens(line.slice(lastEnd));
  return tokens.length ? tokens[0] : null;
}

function valuesOnLabelLines(text, labelRe) {
  const values = [];
  for (const line of String(text || '').split(/\n/)) {
    if (!labelRe.test(line)) continue;
    labelRe.lastIndex = 0;
    const value = moneyAfterLastLabel(line, labelRe);
    if (value != null) values.push(value);
  }
  return values;
}

/**
 * Official GeM total labels only.
 * Used by existing scrapers — do not add weaker sums here, or a re-scrape
 * can overwrite a good listing total.
 * 1) Total Contract Value Including All Duties and Taxes (INR)
 * 2) Total Order Value (in INR)
 */
function extractLabeledContractTotal(text) {
  const raw = String(text || '');
  const contractTotals = valuesOnLabelLines(
    raw,
    /Total Contract Value Including All Duties and Taxes\s*\(\s*INR\s*\)/i
  );
  if (contractTotals.length) return roundMoney(contractTotals[0]);

  const orderTotals = valuesOnLabelLines(raw, /Total Order Value(?:\s*\([^)]*\))?/i);
  if (orderTotals.length) return roundMoney(orderTotals[0]);
  return null;
}

/**
 * Fix-script extractor. Official label first, then other PDF formats.
 * 3) Sum of Total Value Including Addons (INR)
 * 4) Sum of product line totals ("N pieces unit tax line")
 */
function extractContractTotalValue(text) {
  const labeled = extractLabeledContractTotal(text);
  if (labeled != null) return labeled;

  const raw = String(text || '');
  const addonTotals = valuesOnLabelLines(
    raw,
    /Total Value Including Addons\s*\(\s*INR\s*\)/i
  );
  if (addonTotals.length) {
    return roundMoney(addonTotals.reduce((sum, n) => sum + n, 0));
  }

  const lineTotals = [];
  const rowRe =
    /(\d+)\s+pieces\s+([\d,]+(?:\.\d+)?)\s+(?:[\d,]+(?:\.\d+)?|NA|-)\s+([\d,]+(?:\.\d+)?)/gi;
  let row;
  while ((row = rowRe.exec(raw)) !== null) {
    const line = Number(String(row[3]).replace(/,/g, ''));
    if (Number.isFinite(line) && line > 0) lineTotals.push(line);
  }
  if (lineTotals.length) return roundMoney(lineTotals.reduce((sum, n) => sum + n, 0));

  return null;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parsePdfSections(text) {
  const raw = String(text || '');

  const orgSec = sectionBetween(
    raw,
    /Organisation Details|Organization Details/i,
    /Buyer Details|Seller Details|Service Provider Details|Financial Approval Detail|Paying Authority Details|Product Details|Service Details|Consignee Details?|Terms and Conditions|Generated Date|Contract No/i
  );
  const buyerSec = sectionBetween(
    raw,
    /Buyer Details/i,
    /Financial Approval Detail|Paying Authority Details|Seller Details|Service Provider Details|Organisation Details|Organization Details|Product Details|Service Details|Consignee Details?|Terms and Conditions/i
  );
  const financialSec = sectionBetween(
    raw,
    /Financial Approval Detail/i,
    /Paying Authority Details|Seller Details|Service Provider Details|Buyer Details|Organisation Details|Organization Details|Product Details|Service Details|Consignee Details?|Terms and Conditions/i
  );
  const payingSec = sectionBetween(
    raw,
    /Paying Authority Details/i,
    /Seller Details|Service Provider Details|Buyer Details|Product Details|Service Details|Consignee Details?|Organisation Details|Organization Details|Terms and Conditions/i
  );
  // Goods: "Seller Details" | Services: "Service Provider Details"
  const sellerSec = sectionBetween(
    raw,
    /Seller Details|Service Provider Details/i,
    /Financial Approval Detail|Paying Authority Details|Buyer Details|Product Details|Service Details|Consignee Details?|Organisation Details|Organization Details|\*GST|Delivery Instructions|Terms and Conditions|SLA Details|ePBG Detail/i
  );
  const productSec = sectionBetween(
    raw,
    /Product Details/i,
    /Consignee Details?|Seller Details|Service Provider Details|Buyer Details|Financial Approval Detail|Product Specification|Terms and Conditions|ePBG Detail|SLA Details/i
  );
  const serviceSec = sectionBetween(
    raw,
    /Service Details/i,
    /SLA Details|Seller Details|Service Provider Details|Buyer Details|Consignee Details?|Terms and Conditions|ePBG Detail|Product Details/i
  );

  // Delivery instructions header only (avoid SLA prose containing the phrase)
  const deliverySec = sectionBetween(
    raw,
    /(?:^|\n)\s*Delivery Instructions\s*(?:\||:)/i,
    /Product Details|Service Details|Consignee Details?|Terms and Conditions|Seller Details|Service Provider Details/i
  );

  const contract_number = pickField(raw, [
    /Contract No\s*(?:\||:)[^\n]*?::?\s*(GEMC-\d+)/i,
    /(GEMC-\d+)/,
  ]);
  const generated_date =
    pickField(raw, [
      /Contract Generated Date\s*(?:\||:)?\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
      /Generated Date\s*(?:\||:)?\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
    ]) || cleanVal(pickLabeled(raw, ['Contract Generated Date', 'Generated Date']));

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
    address: cleanPdfAddress(pickLabeled(buyerSec, ['Address'], { multiline: true })),
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
    address: cleanPdfAddress(pickLabeled(payingSec, ['Address'], { multiline: true })),
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
    address: cleanPdfAddress(pickLabeled(sellerSec, ['Address'], { multiline: true })),
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

  let products = parseProducts(productSec);
  if (!products.length) {
    products = parseServiceDetails(serviceSec, raw);
  }
  const consinee_details = parseConsignee(raw);

  // Service PDFs often put qty only in the consignee table — backfill product qty
  if (
    products.length === 1 &&
    !products[0].quantity &&
    consinee_details?.quantity
  ) {
    products[0].quantity = consinee_details.quantity;
  }

  // Seller Details → goods (is_service=false); Service Provider Details → service (is_service=true)
  const hasServiceProvider = /Service Provider Details/i.test(raw);
  const hasSellerDetails = /(?:^|[|\n])\s*Seller Details\b/i.test(raw);
  const is_service = hasServiceProvider ? true : hasSellerDetails ? false : Boolean(serviceSec);

  // Service: "Total Contract Value Including All Duties and Taxes(INR) 8250672"
  // Goods:  "Total Order Value (in INR)  1,625.573  1,625.573"
  const extractedTotal = extractLabeledContractTotal(raw);
  const total_order_value =
    extractedTotal != null
      ? String(extractedTotal)
      : parseMoney(
          pickField(raw, [
            /Total Order Value\s*\([^)]*\)\s*([\d,]+(?:\.\d+)?)/i,
            /Total Order Value[^0-9\n]{0,60}([\d,]+(?:\.\d+)?)/i,
            /कुल\s*ऑड[^\d]{0,40}([\d,]+(?:\.\d+)?)/i,
          ])
        );

  // Bid/RA/PBP No.: GEM/2026/B/7084602
  let bid_number =
    pickField(raw, [
      /Bid\s*\/\s*RA\s*\/\s*PBP\s*No\.?\s*(?:\||:)?\s*([^\n|;]+)/i,
      /Bid\/RA\/PBP\s*No\.?\s*(?:\||:)?\s*([^\n|;]+)/i,
      /Bid Number\s*(?:\||:)?\s*([^\n|;]+)/i,
    ]) || '';
  bid_number = stripFieldLabel(bid_number, ['Bid/RA/PBP No.', 'Bid/RA/PBP No', 'Bid Number']);
  if (/^(?:NA|N\/A|nil|none|-|–|—)$/i.test(bid_number)) bid_number = '';

  // Procurement Mode: Bid | BID/RA | Direct
  let procurement_mode =
    pickField(raw, [/Procurement Mode\s*(?:\||:)?\s*([^\n|;]+)/i]) ||
    pickLabeled(raw, ['Procurement Mode', 'Buying Mode']) ||
    '';
  procurement_mode = stripFieldLabel(procurement_mode, [
    'Procurement Mode',
    'Buying Mode',
  ]);
  if (/^(?:NA|N\/A|nil|none|-|–|—)$/i.test(procurement_mode)) procurement_mode = '';

  // If products missed unit_price but Total Order Value exists and qty known, leave total on contract
  if (total_order_value && products.length === 1 && !products[0].unit_price) {
    const qty = Number(products[0].quantity);
    const total = Number(total_order_value);
    if (!Number.isNaN(qty) && qty > 0 && !Number.isNaN(total) && total > 0) {
      products[0].unit_price = String(Number((total / qty).toFixed(6)));
      products[0].line_total = total_order_value;
    }
  }

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
    is_service,
    total_order_value,
    bid_number,
    procurement_mode,
  };
}

module.exports = { parsePdfSections, extractContractTotalValue, cleanVal, pickLabeled };
