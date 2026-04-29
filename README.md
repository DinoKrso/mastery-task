# DocProcessor - Smart Document Processing System

A full-stack application that processes business documents (invoices, purchase orders), extracts structured data, validates it, and presents it through a clean review interface.

## Live Demo

> Deployed on Vercel - link available after deployment

## Tech Stack

- **Frontend/Backend:** Next.js 14 (App Router, TypeScript)
- **Extraction:** Rule-based parser (`lib/parser.ts`) - regex + structural parsing for PDF/CSV/TXT; Tesseract.js OCR for images (screenshots)
- **Database:** Supabase (PostgreSQL)
- **UI:** Tailwind CSS + shadcn/ui
- **Deployment:** Vercel

## Setup

### 1. Clone & install

```bash
git clone <repo-url>
cd task
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in your values:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key |

### 3. Set up the database

Run the migration in the Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'needs_review', 'validated', 'rejected')),
  document_type TEXT CHECK (document_type IN ('invoice', 'purchase_order', 'unknown')),
  supplier TEXT,
  document_number TEXT,
  issue_date TEXT,
  due_date TEXT,
  currency TEXT,
  line_items JSONB DEFAULT '[]',
  subtotal NUMERIC,
  tax NUMERIC,
  total NUMERIC,
  validation_issues JSONB DEFAULT '[]',
  raw_extraction JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations" ON documents FOR ALL USING (true) WITH CHECK (true);
```

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Deploy to Vercel

```bash
npx vercel --prod
```

Set the same environment variables in the Vercel dashboard.

---

## Approach

### Document Ingestion

Files are uploaded via a drag-and-drop interface. Supported formats:

- **PDF** - text extracted with `pdf-parse`
- **Images (PNG, JPG, WEBP, GIF)** - OCR with Tesseract.js (+ preprocessing)
- **CSV** - parsed and converted to a human-readable format before extraction
- **TXT** - sent as-is

### Extraction Engine (`lib/parser.ts`)

A custom rule-based parser + OCR (no external AI API required by default):

- **CSV** - detects column headers (desc, qty, price, total) and builds line items from each row
- **TXT / PDF** - regex patterns detect document type, supplier, document number, dates (multiple formats normalised to ISO 8601), currency codes and symbols, amounts labelled with keywords (total, subtotal, tax, VAT), and table-formatted line items
- **Images** - Tesseract.js OCR extracts text, which is then fed through the same text parser

### Accuracy Notes

- **Works well:** `.csv`, `.txt`, and most `.pdf` files (especially PDFs that contain real text).
- **Works partially:** screenshots / images. OCR quality varies with DPI, blur, compression, fonts, and complex layouts. The system may extract some fields correctly while missing or misreading others.

### Validation Engine (`lib/validation.ts`)

Custom TypeScript logic validates:

- Missing required fields (document type, number, supplier, currency, dates)
- Date format correctness (ISO 8601) and logical order (due date ≥ issue date)
- Per-line-item arithmetic: `qty × unit_price = line total`
- Subtotal consistency: sum of line item totals
- Grand total check: `subtotal + tax = total`
- Duplicate document number detection across the entire database

### Status Workflow

```
Uploaded → Needs Review → Validated
                       ↘ Rejected
```

All documents start in "Needs Review" after extraction. A reviewer can manually correct any field and then approve or reject the document.

### Review Interface

Each document has a full edit form where every extracted field can be corrected. Validation issues are highlighted at the top. The reviewer can save changes, validate, or reject the document.

---

## Improvements I Would Make

1. **Use ChatGPT “mini” for image processing** - use `gpt-4o-mini` vision to extract a strict JSON schema for screenshots/images (and scanned PDFs). This should significantly improve correctness for totals and line items compared to OCR + regex alone.
2. **Confidence scores** - return a confidence level per field so the UI can highlight low-confidence extractions
3. **File storage** - store original files in Supabase Storage for re-processing or auditing
4. **Background processing** - use a queue (e.g. Inngest, Trigger.dev) so large batches don't block the HTTP response
5. **Auth** - add Supabase Auth so multiple reviewers can be tracked per document
6. **Audit log** - record every field change with who made it and when
7. **Unit tests** - the validation engine (`lib/validation.ts`) is pure and easily unit-testable with Vitest
8. **Bulk upload** - allow uploading a folder or ZIP of documents at once
9. **Export** - CSV/Excel export of validated documents for accounting systems
