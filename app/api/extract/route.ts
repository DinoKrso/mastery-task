import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validate } from '@/lib/validation';
import { parseCsv, parsePlainText } from '@/lib/parser';
import { ExtractedData, FileType } from '@/lib/types';
import type { PSM } from 'tesseract.js';

export const runtime = 'nodejs';
// Vercel default function timeout is ~10s. OCR cold start + parsing easily exceeds that.
// Bumping to 60s is the max on Vercel Hobby; Pro plans support more.
export const maxDuration = 60;

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
  psm: PSM;
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
  const maxOcrMs = 8_000;
  const startedAt = Date.now();
  let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | null = null;

  try {
    const { join } = await import('node:path');
    const { createWorker, PSM } = await import('tesseract.js');
    // Avoid Next's bundled module id here; worker_threads needs a real filesystem path.
    const workerPath = join(process.cwd(), 'node_modules/tesseract.js/src/worker-script/node/index.js');
    // Use the bundled language data (eng.traineddata at the project root) instead of
    // letting Tesseract download ~10MB from the CDN on every cold start.
    const langPath = process.cwd();
    worker = await createWorker('eng', undefined, {
      workerPath,
      langPath,
      cachePath: '/tmp',
      cacheMethod: 'readOnly',
      gzip: false,
    });

    const variants = await buildOcrImageVariants(buffer);
    // Keep OCR bounded and predictable: fewer combinations, better latency.
    const psmModes: PSM[] = [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN];
    const attempts: OcrAttempt[] = [];
    let bestSoFar: OcrAttempt | null = null;

    // Prefer high-signal paths first. This avoids "forever" uploads on screenshots.
    const fastPlan: Array<{ variantName: string; psm: PSM }> = [
      { variantName: 'raw', psm: PSM.SINGLE_BLOCK },
      { variantName: 'normalized', psm: PSM.SINGLE_BLOCK },
      { variantName: 'threshold', psm: PSM.SINGLE_COLUMN },
      { variantName: 'raw', psm: PSM.SINGLE_COLUMN },
    ];

    for (const step of fastPlan) {
      const variant = variants.find(v => v.name === step.variantName);
      if (!variant) continue;
      const psm = step.psm;

      const remainingMs = maxOcrMs - (Date.now() - startedAt);
      if (remainingMs < 1_200) break;

      await worker.setParameters({
        tessedit_pageseg_mode: psm,
        preserve_interword_spaces: '1',
      });

      try {
        const { data } = await worker.recognize(variant.buffer);
        const tsvText = reconstructTextFromTsv(data.tsv ?? '');
        const text = (tsvText || data.text || '').trim();
        const parsed = parsePlainText(text);
        const confidence = Number.isFinite(data.confidence) ? data.confidence : 0;
        const attempt: OcrAttempt = {
          variant: variant.name,
          psm,
          confidence,
          text,
          parsed,
          score: scoreExtraction(parsed, text, confidence),
        };
        attempts.push(attempt);

        if (!bestSoFar || attempt.score > bestSoFar.score) bestSoFar = attempt;
        // Strong result found: stop early.
        if (bestSoFar && (bestSoFar.score >= 82 || (bestSoFar.score >= 70 && bestSoFar.text.length >= 160))) {
          break;
        }
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

      if (Date.now() - startedAt > maxOcrMs) break;
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
  // In some production Node runtimes, pdf.js expects DOMMatrix; polyfill it if missing.
  if (typeof (globalThis as unknown as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
    const mod = await import('dommatrix');
    // dommatrix exports a CSSMatrix-compatible class as the default export.
    (globalThis as unknown as { DOMMatrix?: unknown }).DOMMatrix = (mod as { default: unknown }).default;
  }

  // Use pdfjs directly in worker-free mode for reliability in serverless deployments.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const cMapUrl = pathToFileURL(
    join(process.cwd(), 'node_modules/pdfjs-dist/cmaps/'),
  ).toString();
  const standardFontDataUrl = pathToFileURL(
    join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/'),
  ).toString();
  try {
    const loadingTask = pdfjs.getDocument(({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
      cMapUrl,
      cMapPacked: true,
      standardFontDataUrl,
      verbosity: (pdfjs as { VerbosityLevel?: { ERRORS?: number } }).VerbosityLevel?.ERRORS ?? 0,
    }) as unknown as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const doc = await loadingTask.promise;
      try {
        const maxPages = Math.min(2, doc.numPages || 1);
        const pageTexts: string[] = [];
        for (let i = 1; i <= maxPages; i++) {
          const page = await doc.getPage(i);
          try {
            const viewport = page.getViewport({ scale: 1 });
            const content = await page.getTextContent();
            // Reconstruct lines from item positions so the downstream parser can
            // recognise things like "Subtotal: 950" or "Total: 800.00" on their
            // own line. A naive join with spaces would lose all line structure.
            type Item = { str?: string; transform?: number[]; hasEOL?: boolean; width?: number };
            const items = (content.items ?? []) as Item[];
            const buf: string[] = [];
            let lastY: number | null = null;
            let lastX: number | null = null;
            const lineThreshold = 4; // px in viewport coords
            const wordGap = 2;       // px gap that implies a space
            for (const item of items) {
              if (!item || typeof item.str !== 'string') continue;
              const tm = item.transform;
              if (!tm || tm.length < 6) {
                buf.push(item.str);
                continue;
              }
              const [x, y] = viewport.convertToViewportPoint(tm[4], tm[5]);
              if (lastY !== null && Math.abs(lastY - y) > lineThreshold) {
                buf.push('\n');
                lastX = null;
              } else if (lastX !== null && x - lastX > wordGap) {
                buf.push(' ');
              }
              buf.push(item.str);
              lastX = x + (item.width ?? 0);
              lastY = y;
              if (item.hasEOL) {
                buf.push('\n');
                lastX = null;
              }
            }
            const pageText = buf.join('').replace(/[ \t]+\n/g, '\n').trim();
            if (pageText) pageTexts.push(pageText);
          } finally {
            page.cleanup();
          }
        }

        const text = pageTexts.join('\n\n').trim();
        if (text.length > 0) return parsePlainText(text);

        // Scanned/image-only PDF: no selectable text available in this worker-free path.
        return emptyExtraction({ pdf_warning: 'No selectable text found in PDF' });
      } finally {
        await doc.destroy();
      }
    } finally {
      await loadingTask.destroy();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return emptyExtraction({ pdf_error: message });
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
