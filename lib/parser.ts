import { ExtractedData, LineItem } from './types';

// ── Date normalisation ────────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04',
  jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function normaliseDate(raw: string): string | null {
  const s = raw.trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Numeric date, two parts + 4-digit year. Could be DMY (EU) or MDY (US) — disambiguate by validity
  // rather than guessing, so "5/13/2011" can't produce an invalid month like 13.
  const numeric = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (numeric) {
    const [, a, b, y] = numeric;
    const ai = parseInt(a, 10);
    const bi = parseInt(b, 10);
    const pad = (n: number) => String(n).padStart(2, '0');

    // Only one ordering can be valid when one part is > 12.
    if (ai > 12 && bi >= 1 && bi <= 12) return `${y}-${pad(bi)}-${pad(ai)}`; // DMY
    if (bi > 12 && ai >= 1 && ai <= 12) return `${y}-${pad(ai)}-${pad(bi)}`; // MDY
    if (ai >= 1 && ai <= 12 && bi >= 1 && bi <= 31) {
      // Ambiguous. "/" is most often US (MDY), other separators usually EU (DMY).
      if (s.includes('/')) return `${y}-${pad(ai)}-${pad(bi)}`;
      return `${y}-${pad(bi)}-${pad(ai)}`;
    }
    return null;
  }

  // "26/05/2021" covered above; "May 13, 2011" / "13 May 2011"
  const named = s.match(/(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})/);
  if (named) {
    const mon = MONTH_NAMES[named[2].toLowerCase()];
    if (mon) return `${named[3]}-${mon}-${named[1].padStart(2, '0')}`;
  }
  const named2 = s.match(/([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (named2) {
    const mon = MONTH_NAMES[named2[1].toLowerCase()];
    if (mon) return `${named2[3]}-${mon}-${named2[2].padStart(2, '0')}`;
  }

  return null;
}

function findDate(text: string): string | null {
  const patterns = [
    /\b(\d{4}[-\/]\d{2}[-\/]\d{2})\b/,
    /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})\b/,
    /\b(\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+\d{4})\b/i,
    /\b((?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s+\d{4})\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const d = normaliseDate(m[1]);
      if (d) return d;
    }
  }
  return null;
}

function findAllDates(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(\d{4}[-\/]\d{2}[-\/]\d{2})\b/g,
    /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})\b/g,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const d = normaliseDate(m[1]);
      if (d && !found.includes(d)) found.push(d);
    }
  }
  return found;
}

// ── Currency ──────────────────────────────────────────────────────────────────

function findCurrency(text: string): string | null {
  const codes = text.match(/\b(EUR|USD|GBP|BAM|CHF|SEK|NOK|DKK|CAD|AUD|JPY|HRK|RSD|HUF|PLN|CZK|RON)\b/g);
  if (codes?.length) return codes[0].toUpperCase();
  if (/€/.test(text)) return 'EUR';
  if (/£/.test(text)) return 'GBP';
  if (/\$/.test(text)) return 'USD';
  return null;
}

// ── Number cleaning ───────────────────────────────────────────────────────────

function parseNum(s: string): number | null {
  const cleaned = s.replace(/[€$£\s]/g, '').replace(/,(?=\d{3})/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function extractNumbersFromLine(line: string): number[] {
  // Captures 1,234.56 / 1.234,56 / 1234 / 1234.5 etc, with optional currency.
  // Intentionally does NOT include arbitrary spaces inside the number token, otherwise
  // rows like "Service A 5 129 645" get merged into one huge number.
  const matches = line.match(/[€$£]?\s*\d[\d.,']*/g) ?? [];
  const nums: number[] = [];
  for (const raw of matches) {
    const n = parseNum(raw);
    if (n !== null) nums.push(n);
  }
  return nums;
}

type AmountCandidate = {
  value: number;
  lineIdx: number;
  line: string;
  keywordPos: number;
};

function collectAmountCandidates(
  text: string,
  keywords: string[],
  excludeRegex?: RegExp
): AmountCandidate[] {
  const lines = text.split(/\r?\n/);
  const candidates: AmountCandidate[] = [];

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    if (excludeRegex?.test(line)) return;

    let kwPos = Infinity;
    let matched = false;
    for (const kw of keywords) {
      const re = new RegExp(`\\b${kw}\\b`, 'i');
      const m = re.exec(line);
      if (m) {
        matched = true;
        kwPos = Math.min(kwPos, m.index);
      }
    }
    if (!matched) return;

    const nums = extractNumbersFromLine(line);
    if (!nums.length) return;
    // The amount is almost always the LAST number on a label line.
    candidates.push({ value: nums[nums.length - 1], lineIdx: idx, line, keywordPos: kwPos });
  });

  return candidates;
}

function approxEquals(a: number, b: number, tolerance = 0.05): boolean {
  if (b === 0) return Math.abs(a) <= 0.5;
  return Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * tolerance);
}

function findTaxRate(text: string): number | null {
  // "Tax rate ... 6.250%" or "VAT rate: 20%"
  const m = text.match(/\btax\s*rate\b[^\d%]*(\d+(?:[.,]\d+)?)\s*%/i)
    || text.match(/\bvat\s*rate\b[^\d%]*(\d+(?:[.,]\d+)?)\s*%/i);
  if (!m) return null;
  return parseNum(m[1]);
}

// ── Document type ─────────────────────────────────────────────────────────────

function detectDocType(text: string): 'invoice' | 'purchase_order' | 'unknown' {
  const t = text.toLowerCase();
  if (/purchase.?order|^po\b|p\.o\./m.test(t)) return 'purchase_order';
  if (/invoice|facture|factura|faktura|rechnung|račun|proforma/i.test(t)) return 'invoice';
  return 'unknown';
}

// ── Supplier ──────────────────────────────────────────────────────────────────

function findSupplier(text: string): string | null {
  const cleanCandidate = (raw: string): string | null => {
    let v = raw.trim();
    // Strip surrounding template brackets/quotes ("[Company Name]" → "Company Name").
    v = v.replace(/^[\[\(\{"'`]+|[\]\)\}"'`]+$/g, '').trim();
    if (v.length < 2 || v.length > 60) return null;
    // Skip common template placeholders (these are placeholders in many invoice templates).
    if (/^(company\s*name|company\s*slogan|stress\s*address|street\s*address|name\s*here|your\s*company\s*name|name|address|phone)$/i.test(v)) return null;
    // Drop trailing colons and slashes that sometimes leak in from labels.
    return v.replace(/[:\s]+$/g, '');
  };

  // Try labelled patterns first (most reliable).
  const labelPatterns = [
    /(?:bill(?:ed)?\s*from|sold\s*by|supplier|vendor|company\s*name|from)\s*[:\-]?\s*([^\n]{2,60})/i,
  ];
  for (const p of labelPatterns) {
    const m = text.match(p);
    if (m) {
      const c = cleanCandidate(m[1]);
      if (c) return c;
    }
  }

  // Fallback: pick the first plausible "company-like" line near the top.
  const topLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 8);
  for (const line of topLines) {
    if (/^\d/.test(line)) continue; // skip dates / numbers
    if (/(invoice|receipt|date|bill\s*to|description|amount|total|tax|phone|fax|email|customer)/i.test(line)) continue;
    const c = cleanCandidate(line);
    if (c) return c;
  }
  return null;
}

// ── Document number ───────────────────────────────────────────────────────────

function findDocNumber(text: string): string | null {
  const patterns = [
    // Prefer explicitly labeled number fields first.
    /(?:document\s*)?number[:\s#]*([A-Z0-9][A-Z0-9\-\/]{1,30})/i,
    /invoice\s*(?:no|number|#)[:\s#]*([A-Z0-9][A-Z0-9\-\/]{1,30})/i,
    /(?:inv|invoice|po|purchase order|order|facture|faktura|rechnung|n[oº°])[:\s#\.]*((?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{1,30})/i,
    /\b(INV[-\s]?\d+)\b/i,
    /\b(PO[-\s]?\d+)\b/i,
    /\b([A-Z]{2,4}-\d{4,})\b/,
    /#\s*(\d{1,10})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const candidate = m[1].trim();
    // Avoid false positives like "Supplier" (no digits).
    if (!/\d/.test(candidate)) continue;
    return candidate;
  }
  return null;
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCSV(raw: string): ExtractedData {
  const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return emptyResult();

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

  const colIndex = (names: string[]) => {
    for (const n of names) {
      const i = headers.findIndex(h => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };

  const descCol = colIndex(['desc', 'description', 'item', 'name', 'product']);
  const qtyCol = colIndex(['qty', 'quantity', 'count', 'units']);
  const priceCol = colIndex(['price', 'unit', 'rate', 'unit_price', 'unitprice']);
  const totalCol = colIndex(['total', 'amount', 'subtotal', 'line_total']);

  const lineItems: LineItem[] = [];
  let computedSubtotal = 0;

  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(c => c.trim().replace(/['"]/g, ''));
    const description = descCol >= 0 ? cells[descCol] : cells[0] ?? 'Item';
    const quantity = qtyCol >= 0 ? parseNum(cells[qtyCol] ?? '') : null;
    const unit_price = priceCol >= 0 ? parseNum(cells[priceCol] ?? '') : null;
    const total = totalCol >= 0 ? parseNum(cells[totalCol] ?? '') : null;

    const lineTotal = total ?? (quantity != null && unit_price != null ? Math.round(quantity * unit_price * 100) / 100 : null);
    computedSubtotal += lineTotal ?? 0;

    lineItems.push({ description, quantity, unit_price, total: lineTotal });
  }

  return {
    document_type: 'invoice',
    supplier: null,
    document_number: null,
    issue_date: null,
    due_date: null,
    currency: null,
    line_items: lineItems,
    subtotal: lineItems.length > 0 ? Math.round(computedSubtotal * 100) / 100 : null,
    tax: null,
    total: null,
  };
}

// ── Text / PDF parser ─────────────────────────────────────────────────────────

function parseText(text: string): ExtractedData {
  let docType = detectDocType(text);
  const currency = findCurrency(text);
  const supplier = findSupplier(text);
  const docNumber = findDocNumber(text);

  const dates = findAllDates(text);
  let issueDate: string | null = null;
  let dueDate: string | null = null;

  // Look for labelled dates first
  const issuedMatch = text.match(/(?:date|issued?|invoice date|date de facture)[:\s]+([^\n]{5,20})/i);
  const dueMatch = text.match(/(?:due|due date|payment due|expiry|échéance)[:\s]+([^\n]{5,20})/i);
  if (issuedMatch) issueDate = findDate(issuedMatch[1]);
  if (dueMatch) dueDate = findDate(dueMatch[1]);

  // Fall back to unlabelled dates
  if (!issueDate && dates[0]) issueDate = dates[0];
  if (!dueDate && dates[1]) dueDate = dates[1];

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Amount extraction is candidate-based with cross-validation.
  // We collect ALL plausible candidates per field, then pick the one that best satisfies
  // invoice math (subtotal + tax ≈ total, line_items.sum ≈ subtotal, total ≥ subtotal).

  // SUBTOTAL --------------------------------------------------------------------------------
  const subtotalCandidates = collectAmountCandidates(
    text,
    ['subtotal', 'sub-total', 'net amount', 'total ht', 'netto', 'hors taxe', 'subtotal without vat'],
    /\btax\s*rate\b/i
  );

  // TAX -------------------------------------------------------------------------------------
  // Prefer summing VAT breakdown lines when present (common on receipts).
  const vatLines = lines.filter(l => /^\s*vat\b/i.test(l) && /\bof\b/i.test(l));
  const vatSum = vatLines.reduce((acc, l) => {
    const nums = extractNumbersFromLine(l);
    const last = nums[nums.length - 1];
    return typeof last === 'number' ? acc + last : acc;
  }, 0);

  const taxCandidates = collectAmountCandidates(
    text,
    ['tax due', 'tax amount', 'vat', 'tva', 'mwst', 'mva', 'tax'],
    // "Tax rate" describes the rate not the amount; pure-percent-only rows are also rates.
    /\btax\s*rate\b|^[^%\d]*\d+(?:[.,]\d+)?\s*%\s*$/i
  );
  const taxRate = findTaxRate(text);

  // TOTAL -----------------------------------------------------------------------------------
  const totalCandidates = collectAmountCandidates(
    text,
    ['total due', 'amount due', 'grand total', 'balance due', 'total', 'montant total', 'total ttc', 'gesamtbetrag'],
    // Skip subtotal lines, payment-term prose ("Total payment due in 30 days"), and tax-only lines.
    /\bsub-?total\b|\bdue\s+in\s+\d+\s*days?\b|\btotal\s+payment\b|\btax(?:able|\s*due)?\b/i
  );

  // Pick subtotal: prefer the latest candidate (subtotal usually appears once near the totals block).
  const subtotal = subtotalCandidates.length
    ? subtotalCandidates.sort((a, b) => b.lineIdx - a.lineIdx)[0].value
    : null;

  // Pick tax: VAT-line sum > tax-rate-implied amount > best candidate.
  let tax: number | null = null;
  if (vatSum > 0) {
    tax = Math.round(vatSum * 100) / 100;
  } else {
    // If we know subtotal and tax rate, expected tax ≈ subtotal * rate / 100.
    const expectedTax = subtotal != null && taxRate != null
      ? Math.round(subtotal * (taxRate / 100) * 100) / 100
      : null;

    if (taxCandidates.length) {
      const scored = taxCandidates.map(c => {
        let score = 0;
        if (expectedTax != null && approxEquals(c.value, expectedTax, 0.05)) score += 30;
        // Tax should never exceed the subtotal, give or take rounding.
        if (subtotal != null && c.value > subtotal * 1.05) score -= 25;
        // Prefer rows where the keyword sits near the start (label-like).
        if (c.keywordPos <= 5) score += 4;
        // Prefer later occurrences (totals block at bottom).
        score += c.lineIdx * 0.05;
        return { c, score };
      });
      scored.sort((a, b) => b.score - a.score);
      tax = scored[0].c.value;
    } else if (expectedTax != null) {
      tax = expectedTax;
    }
  }

  // Initial total pick (without line items yet). It will be re-scored below once items are parsed.
  let total: number | null = null;
  if (totalCandidates.length) {
    const scored = totalCandidates.map(c => {
      let score = 0;
      if (subtotal != null && tax != null && approxEquals(c.value, subtotal + tax, 0.03)) score += 60;
      if (subtotal != null && c.value >= subtotal - 0.5) score += 8;
      if (subtotal != null && c.value < subtotal - 0.5) score -= 25;
      if (c.keywordPos <= 5) score += 5;
      score += c.lineIdx * 0.1;
      return { c, score };
    });
    scored.sort((a, b) => b.score - a.score);
    total = scored[0].c.value;
  }

  // Extract line items from table-like rows: "Description   qty   price   total"
  const lineItems: LineItem[] = [];
  const tableRow = /^(.{5,40})\s{2,}(\d+(?:[.,]\d+)?)\s{2,}(\d+(?:[.,]\d+)?)\s{2,}(\d+(?:[.,]\d+)?)/gm;
  let m;
  while ((m = tableRow.exec(text)) !== null) {
    lineItems.push({
      description: m[1].trim(),
      quantity: parseNum(m[2]),
      unit_price: parseNum(m[3]),
      total: parseNum(m[4]),
    });
  }

  // Fallback: parse table-like rows when we can spot a header. Supports many layouts:
  //   "Description Qty Unit Price Total"           (full table)
  //   "Description Qty Unit Price VAT Amount"      (receipt-style, with VAT %)
  //   "DESCRIPTION TAXED AMOUNT"                   (template-style, no qty/unit columns)
  //   "Item / Service ... Total"                   (services-only invoices)
  if (lineItems.length === 0) {
    const headerIdx = lines.findIndex(l =>
      /\b(description|item|service|product)\b/i.test(l)
      && /\b(amount|total|price)\b/i.test(l)
    );
    if (headerIdx !== -1) {
      for (const raw of lines.slice(headerIdx + 1)) {
        // Stop when totals section begins.
        if (/\b(sub-?total|tax(?:able|\s*due)?|vat|total\s*due|grand\s*total|balance\s*due|total)\b/i.test(raw)) break;

        const nums = extractNumbersFromLine(raw);
        if (nums.length === 0) continue;

        const vatPctMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*%/);
        const vatPct = vatPctMatch ? parseNum(vatPctMatch[1]) : null;
        const totalAmt = nums[nums.length - 1];

        let unitPrice: number | null = null;
        let qty: number | null = null;

        if (vatPct != null) {
          // Receipt row: ... unit_price VAT% total
          const beforeVat = raw.slice(0, vatPctMatch!.index);
          const beforeNums = extractNumbersFromLine(beforeVat);
          unitPrice = beforeNums.length ? beforeNums[beforeNums.length - 1] : null;
          qty = beforeNums.length >= 2 ? beforeNums[0] : null;
        } else if (nums.length >= 3) {
          // Standard table row: qty unit_price ... total
          qty = nums[0];
          unitPrice = nums[nums.length - 2];
        } else if (nums.length === 2) {
          // Two numbers. Could be "qty total" or "unit_price total".
          // Heuristic: small positive integer => qty.
          const first = nums[0];
          if (Number.isInteger(first) && first > 0 && first < 1000) {
            qty = first;
          } else {
            unitPrice = first;
          }
        }
        // nums.length === 1: only the line total (e.g. "[Service Fee]   230.00").

        // Description is everything before the first numeric token.
        const firstNumIdx = raw.search(/\d/);
        let desc = (firstNumIdx > 0 ? raw.slice(0, firstNumIdx) : raw).trim().replace(/[-–—:]$/, '').trim();
        // Strip surrounding brackets template invoices use, e.g. "[Service Fee]" → "Service Fee".
        desc = desc.replace(/^[\[\(\{]+|[\]\)\}]+$/g, '').trim();

        if (!desc || desc.length < 2) continue;
        // Filter rows that are clearly not items.
        if (/^(taxed|x|yes|no)$/i.test(desc)) continue;
        // Sanity bound: total should be a sensible monetary amount.
        if (totalAmt == null || totalAmt < 0 || totalAmt > 1_000_000) continue;

        lineItems.push({
          description: desc,
          quantity: qty,
          unit_price: unitPrice,
          total: totalAmt,
        });
      }
    }
  }

  // Re-score totals using line-item information now that we've parsed them.
  // A correct total typically equals (lineItems.sum + tax) or (lineItems.sum) on tax-free docs.
  const lineItemsSum = lineItems.reduce((acc, item) => acc + (item.total ?? 0), 0);
  if (totalCandidates.length) {
    const scored = totalCandidates.map(c => {
      let score = 0;
      if (subtotal != null && tax != null && approxEquals(c.value, subtotal + tax, 0.03)) score += 60;
      if (lineItemsSum > 0 && tax != null && approxEquals(c.value, lineItemsSum + tax, 0.03)) score += 50;
      if (lineItemsSum > 0 && approxEquals(c.value, lineItemsSum, 0.03)) score += 30;
      if (subtotal != null && c.value >= subtotal - 0.5) score += 8;
      if (subtotal != null && c.value < subtotal - 0.5) score -= 25;
      if (lineItemsSum > 0 && c.value < lineItemsSum * 0.6) score -= 20;
      if (c.keywordPos <= 5) score += 5;
      score += c.lineIdx * 0.1;
      return { c, score };
    });
    scored.sort((a, b) => b.score - a.score);
    total = scored[0].c.value;
  }

  // If we have a believable line-items sum but no subtotal, infer one.
  let subtotalFinal = subtotal;
  if (subtotalFinal == null && lineItems.length > 0 && lineItemsSum > 0) {
    subtotalFinal = Math.round(lineItemsSum * 100) / 100;
  }

  // Receipts/screenshots often do not contain the word "invoice", but still have
  // a recognizable item table and total. Treat them as invoice-like documents.
  if (docType === 'unknown' && lineItems.length > 0 && total != null) {
    docType = 'invoice';
  }

  return {
    document_type: docType,
    supplier,
    document_number: docNumber,
    issue_date: issueDate,
    due_date: dueDate,
    currency,
    line_items: lineItems,
    subtotal: subtotalFinal,
    tax: tax,
    total: total,
  };
}

function emptyResult(): ExtractedData {
  return {
    document_type: 'unknown',
    supplier: null,
    document_number: null,
    issue_date: null,
    due_date: null,
    currency: null,
    line_items: [],
    subtotal: null,
    tax: null,
    total: null,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function parseCsv(content: string): ExtractedData {
  return parseCSV(content);
}

export function parsePlainText(content: string): ExtractedData {
  return parseText(content);
}

export function csvToReadable(csv: string): string {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return csv;
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim());
    return headers.map((h, i) => `${h}: ${vals[i] ?? ''}`).join(', ');
  }).join('\n');
}
