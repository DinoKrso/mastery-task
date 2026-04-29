import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validate } from '@/lib/validation';
import { parseCsv, parsePlainText } from '@/lib/parser';
import { ExtractedData, FileType } from '@/lib/types';

export const runtime = 'nodejs';

type ExtractedWithDebug = ExtractedData & {
  _debug?: Record<string, unknown>;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function emptyExtraction(debug?: Record<string, unknown>): ExtractedWithDebug {
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
    ...(debug ? { _debug: debug } : {}),
  };
}

type OcrImageVariant = {
  name: string;
  buffer: Buffer;
};

type OcrAttempt = {
  variant: string;
  psm: string;
  confidence: number;
  text: string;
  parsed: ExtractedData;
  score: number;
};

async function buildOcrImageVariants(buffer: Buffer): Promise<OcrImageVariant[]> {
  try {
    const sharp = (await import('sharp')).default;
    const base = sharp(buffer, { failOnError: false }).rotate();

    const normalized = await base
      .clone()
      .resize({ width: 2200, withoutEnlargement: false })
      .grayscale()
      .normalise()
      .sharpen()
      .png()
      .toBuffer();

    const threshold = await base
      .clone()
      .resize({ width: 2200, withoutEnlargement: false })
      .grayscale()
      .normalise()
      .sharpen()
      .threshold(180)
      .png()
      .toBuffer();

    const inverted = await base
      .clone()
      .resize({ width: 2200, withoutEnlargement: false })
      .grayscale()
      .normalise()
      .negate()
      .threshold(175)
      .png()
      .toBuffer();

    return [
      { name: 'raw', buffer },
      { name: 'normalized', buffer: normalized },
      { name: 'threshold', buffer: threshold },
      { name: 'inverted-threshold', buffer: inverted },
    ];
  } catch {
    return [{ name: 'raw', buffer }];
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise
      .then(value => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch(err => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

type TsvWord = {
  page: number;
  block: number;
  par: number;
  line: number;
  word: number;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  text: string;
};

function parseTsv(tsv: string): TsvWord[] {
  const rows = tsv.split(/\r?\n/).filter(Boolean);
  if (rows.length <= 1) return [];
  const words: TsvWord[] = [];
  for (const row of rows.slice(1)) {
    // TSV format (12 cols): level page_num block_num par_num line_num word_num left top width height conf text
    const cols = row.split('\t');
    if (cols.length < 12) continue;
    const level = Number(cols[0]);
    if (level !== 5) continue; // word-level rows only
    const text = (cols[11] ?? '').trim();
    if (!text) continue;
    words.push({
      page: Number(cols[1]),
      block: Number(cols[2]),
      par: Number(cols[3]),
      line: Number(cols[4]),
      word: Number(cols[5]),
      left: Number(cols[6]),
      top: Number(cols[7]),
      width: Number(cols[8]),
      height: Number(cols[9]),
      conf: Number(cols[10]),
      text,
    });
  }
  return words;
}

function reconstructTextFromTsv(tsv: string): string {
  const words = parseTsv(tsv);
  if (!words.length) return '';

  const byLine = new Map<string, TsvWord[]>();
  for (const w of words) {
    const key = `${w.page}:${w.block}:${w.par}:${w.line}`;
    const arr = byLine.get(key) ?? [];
    arr.push(w);
    byLine.set(key, arr);
  }

  const lineEntries = Array.from(byLine.entries()).map(([key, ws]) => {
    ws.sort((a, b) => a.left - b.left);
    const top = Math.min(...ws.map(w => w.top));
    const [page, block, par, line] = key.split(':').map(Number);
    return { page, block, par, line, top, words: ws };
  });

  // Stable reading order: page -> block -> vertical -> line id
  lineEntries.sort((a, b) =>
    (a.page - b.page)
    || (a.block - b.block)
    || (a.top - b.top)
    || (a.line - b.line)
  );

  const out: string[] = [];
  for (const entry of lineEntries) {
    const ws = entry.words;
    // Estimate a "character width" for spacing from this line's words.
    const charWidths = ws
      .map(w => (w.text.length > 0 ? w.width / w.text.length : 0))
      .filter(x => x > 0 && Number.isFinite(x));
    const avgChar = charWidths.length
      ? charWidths.sort((a, b) => a - b)[Math.floor(charWidths.length / 2)]
      : 8; // fallback

    let line = '';
    let prevRight = ws[0].left;
    for (const w of ws) {
      const gap = w.left - prevRight;
      if (line.length > 0) {
        // Insert proportional spacing. Large gaps become >=2 spaces → helps downstream "table" parsing.
        const spaces = Math.max(1, Math.round(gap / Math.max(4, avgChar)));
        line += ' '.repeat(Math.min(12, spaces));
      }
      line += w.text;
      prevRight = w.left + w.width;
    }
    out.push(line.trimEnd());
  }

  return out.join('\n').trim();
}

function scoreExtraction(parsed: ExtractedData, text: string, confidence: number): number {
  let score = 0;

  if (parsed.document_type !== 'unknown') score += 10;
  if (parsed.supplier) score += 8;
  if (parsed.document_number) score += 8;
  if (parsed.issue_date) score += 8;
  if (parsed.due_date) score += 4;
  if (parsed.currency) score += 8;
  if (parsed.subtotal != null) score += 12;
  if (parsed.tax != null) score += 10;
  if (parsed.total != null) score += 16;

  score += Math.min(45, (parsed.line_items?.length ?? 0) * 12);

  const lineItemSum = (parsed.line_items ?? []).reduce((acc, item) => acc + (item.total ?? 0), 0);
  if (lineItemSum > 0) {
    if (parsed.subtotal != null && Math.abs(lineItemSum - parsed.subtotal) <= Math.max(1, parsed.subtotal * 0.03)) {
      score += 18;
    } else if (parsed.total != null && Math.abs(lineItemSum - parsed.total) <= Math.max(1, parsed.total * 0.03)) {
      score += 12;
    }
  }

  if (parsed.subtotal != null && parsed.tax != null && parsed.total != null) {
    const expected = parsed.subtotal + parsed.tax;
    if (Math.abs(expected - parsed.total) <= Math.max(1, parsed.total * 0.03)) score += 18;
  }

  if (text.length < 40) score -= 20;
  if (text.length > 80) score += 4;
  score += Math.max(0, Math.min(10, confidence / 10));

  return score;
}

async function extractFromImage(buffer: Buffer): Promise<ExtractedWithDebug> {
  const maxOcrMs = 18_000;
  const startedAt = Date.now();
  let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | null = null;

  try {
    const { join } = await import('node:path');
    const { createWorker } = await import('tesseract.js');
    // Avoid Next's bundled module id here; worker_threads needs a real filesystem path.
    const workerPath = join(process.cwd(), 'node_modules/tesseract.js/src/worker-script/node/index.js');
    worker = await createWorker('eng', undefined, { workerPath });

    const variants = await buildOcrImageVariants(buffer);
    const psmModes = ['6', '4', '11']; // block text, columns, sparse text
    const attempts: OcrAttempt[] = [];

    for (const variant of variants) {
      for (const psm of psmModes) {
        const remainingMs = maxOcrMs - (Date.now() - startedAt);
        if (remainingMs < 1_500) break;

        await worker.setParameters({
          tessedit_pageseg_mode: psm,
          preserve_interword_spaces: '1',
        });

        try {
          const { data } = await withTimeout(
            worker.recognize(variant.buffer),
            Math.min(6_000, remainingMs),
            `OCR ${variant.name}/psm-${psm}`
          );
          const tsvText = reconstructTextFromTsv(data.tsv ?? '');
          const text = (tsvText || data.text || '').trim();
          const parsed = parsePlainText(text);
          const confidence = Number.isFinite(data.confidence) ? data.confidence : 0;
          attempts.push({
            variant: variant.name,
            psm,
            confidence,
            text,
            parsed,
            score: scoreExtraction(parsed, text, confidence),
          });
        } catch (err) {
          attempts.push({
            variant: variant.name,
            psm,
            confidence: 0,
            text: '',
            parsed: emptyExtraction(),
            score: -100,
          });
          console.warn(`OCR attempt failed (${variant.name}/psm-${psm}):`, err);
        }
      }
    }

    attempts.sort((a, b) => b.score - a.score);
    const best = attempts[0];
    await worker.terminate();
    worker = null;

    if (!best) {
      return emptyExtraction({
        ocr_error: 'No OCR attempts completed',
        ocr_elapsed_ms: Date.now() - startedAt,
      });
    }

    return {
      ...best.parsed,
      _debug: {
        ocr_text: best.text,
        ocr_confidence: best.confidence,
        ocr_text_length: best.text.length,
        ocr_elapsed_ms: Date.now() - startedAt,
        ocr_best_variant: best.variant,
        ocr_best_psm: best.psm,
        ocr_best_score: best.score,
        ocr_attempts: attempts.slice(0, 8).map(attempt => ({
          variant: attempt.variant,
          psm: attempt.psm,
          confidence: attempt.confidence,
          text_length: attempt.text.length,
          score: attempt.score,
          fields: {
            document_type: attempt.parsed.document_type,
            line_items: attempt.parsed.line_items.length,
            subtotal: attempt.parsed.subtotal,
            tax: attempt.parsed.tax,
            total: attempt.parsed.total,
            currency: attempt.parsed.currency,
          },
        })),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Image OCR failed:', err);
    return emptyExtraction({
      ocr_error: message,
    });
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
}

async function extractFromPdf(buffer: Buffer): Promise<ExtractedData> {
  // pdf-parse v2: use the PDFParse class (not the v1 function API)
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const textRes = await parser.getText({ first: 1, last: 2 });
    const text = (textRes?.text ?? '').trim();

    // If the PDF has real text, prefer it (more accurate than OCR).
    if (text.length >= 80) return parsePlainText(text);

    // Otherwise, treat it as a scanned PDF: render page(s) to PNG, then OCR.
    const shot = await parser.getScreenshot({
      first: 1,
      scale: 2,
      imageDataUrl: false,
      imageBuffer: true,
    });
    const firstPage = shot?.pages?.[0]?.data;
    if (firstPage && Buffer.isBuffer(firstPage)) {
      return await extractFromImage(firstPage);
    }

    return parsePlainText(text);
  } finally {
    await parser.destroy();
  }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const filename = file.name;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  let fileType: FileType;
  let extracted: ExtractedWithDebug;

  try {
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      fileType = 'image';
      const arrayBuffer = await file.arrayBuffer();
      extracted = await extractFromImage(Buffer.from(arrayBuffer));
    } else if (ext === 'pdf') {
      fileType = 'pdf';
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      extracted = await extractFromPdf(buffer);
    } else if (ext === 'csv') {
      fileType = 'csv';
      const text = await file.text();
      extracted = parseCsv(text);
    } else {
      fileType = 'txt';
      const text = await file.text();
      extracted = parsePlainText(text);
    }

    const { data: existing } = await supabase
      .from('documents')
      .select('document_number')
      .not('document_number', 'is', null);

    const existingNumbers = (existing ?? []).map(
      (d: { document_number: string }) => d.document_number
    ).filter(Boolean);

    const issues = validate(extracted, existingNumbers);

    const { data: doc, error } = await supabase
      .from('documents')
      .insert({
        filename,
        file_type: fileType,
        status: 'needs_review',
        document_type: extracted.document_type,
        supplier: extracted.supplier,
        document_number: extracted.document_number,
        issue_date: extracted.issue_date,
        due_date: extracted.due_date,
        currency: extracted.currency,
        line_items: extracted.line_items ?? [],
        subtotal: extracted.subtotal,
        tax: extracted.tax,
        total: extracted.total,
        validation_issues: issues,
        raw_extraction: extracted as unknown as Record<string, unknown>,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
