export type DocumentStatus = 'uploaded' | 'needs_review' | 'validated' | 'rejected';
export type DocumentType = 'invoice' | 'purchase_order' | 'unknown';
export type FileType = 'pdf' | 'image' | 'csv' | 'txt';

export interface LineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  total: number | null;
}

export interface ValidationIssue {
  field: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface Document {
  id: string;
  filename: string;
  file_type: FileType;
  status: DocumentStatus;
  document_type: DocumentType | null;
  supplier: string | null;
  document_number: string | null;
  issue_date: string | null;
  due_date: string | null;
  currency: string | null;
  line_items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  validation_issues: ValidationIssue[];
  raw_extraction: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractedData {
  document_type: DocumentType;
  supplier: string | null;
  document_number: string | null;
  issue_date: string | null;
  due_date: string | null;
  currency: string | null;
  line_items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}
