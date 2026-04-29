import { ExtractedData, ValidationIssue, LineItem } from './types';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str: string): boolean {
  if (!DATE_REGEX.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lineItemTotal(item: LineItem): number | null {
  if (item.quantity != null && item.unit_price != null) {
    return round2(item.quantity * item.unit_price);
  }
  return null;
}

export function validate(data: ExtractedData, allDocumentNumbers: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!data.document_type || data.document_type === 'unknown') {
    issues.push({ field: 'document_type', severity: 'error', message: 'Document type could not be determined' });
  }
  if (!data.supplier) {
    issues.push({ field: 'supplier', severity: 'warning', message: 'Supplier/company name is missing' });
  }
  if (!data.document_number) {
    issues.push({ field: 'document_number', severity: 'warning', message: 'Document number is missing' });
  }
  if (!data.currency) {
    issues.push({ field: 'currency', severity: 'warning', message: 'Currency is missing' });
  }
  if (!data.issue_date) {
    issues.push({ field: 'issue_date', severity: 'warning', message: 'Issue date is missing' });
  } else if (!isValidDate(data.issue_date)) {
    issues.push({ field: 'issue_date', severity: 'error', message: `Issue date "${data.issue_date}" is not a valid date (expected YYYY-MM-DD)` });
  }
  if (data.due_date) {
    if (!isValidDate(data.due_date)) {
      issues.push({ field: 'due_date', severity: 'error', message: `Due date "${data.due_date}" is not a valid date (expected YYYY-MM-DD)` });
    } else if (data.issue_date && isValidDate(data.issue_date) && new Date(data.due_date) < new Date(data.issue_date)) {
      issues.push({ field: 'due_date', severity: 'error', message: 'Due date is before issue date' });
    }
  }

  // Line item validation
  if (!data.line_items || data.line_items.length === 0) {
    issues.push({ field: 'line_items', severity: 'warning', message: 'No line items found' });
  } else {
    let computedSubtotal = 0;
    data.line_items.forEach((item, i) => {
      const expected = lineItemTotal(item);
      if (expected !== null && item.total !== null && Math.abs(expected - item.total) > 0.02) {
        issues.push({
          field: `line_items[${i}]`,
          severity: 'error',
          message: `Line item "${item.description}": qty ${item.quantity} × price ${item.unit_price} = ${expected}, but recorded total is ${item.total}`,
        });
      }
      computedSubtotal += item.total ?? expected ?? 0;
    });

    // Subtotal check
    if (data.subtotal !== null) {
      const diff = Math.abs(round2(computedSubtotal) - data.subtotal);
      if (diff > 0.05) {
        issues.push({
          field: 'subtotal',
          severity: 'error',
          message: `Subtotal ${data.subtotal} does not match sum of line items ${round2(computedSubtotal)}`,
        });
      }
    }

    // Total check: subtotal + tax = total
    if (data.subtotal !== null && data.tax !== null && data.total !== null) {
      const expectedTotal = round2(data.subtotal + data.tax);
      if (Math.abs(expectedTotal - data.total) > 0.05) {
        issues.push({
          field: 'total',
          severity: 'error',
          message: `Total ${data.total} ≠ subtotal ${data.subtotal} + tax ${data.tax} (= ${expectedTotal})`,
        });
      }
    } else if (data.total === null) {
      issues.push({ field: 'total', severity: 'warning', message: 'Total amount is missing' });
    }
  }

  // Duplicate document number
  if (data.document_number && allDocumentNumbers.includes(data.document_number)) {
    issues.push({
      field: 'document_number',
      severity: 'error',
      message: `Document number "${data.document_number}" already exists in the system`,
    });
  }

  return issues;
}
