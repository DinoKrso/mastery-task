'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileText, ImageIcon, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

type UploadState = { status: 'idle' } | { status: 'uploading'; filename: string } | { status: 'success'; docId: string } | { status: 'error'; message: string };

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.txt';
const EXTRACT_TIMEOUT_MS = 60_000;

export function UploadModal({ open, onClose }: Props) {
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (uploadState.status !== 'uploading' || startedAt == null) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
    return () => clearInterval(id);
  }, [uploadState.status, startedAt]);

  const statusLabel = useMemo(() => {
    if (uploadState.status !== 'uploading') return '';
    if (elapsedMs < 800) return 'Uploading…';
    if (elapsedMs < 3_000) return 'Reading document…';
    if (elapsedMs < 7_500) return 'Extracting text (OCR)…';
    if (elapsedMs < 12_000) return 'Parsing fields & line items…';
    return 'Finalizing & saving…';
  }, [elapsedMs, uploadState.status]);

  const handleFile = useCallback(async (file: File) => {
    const now = Date.now();
    setStartedAt(now);
    setElapsedMs(0);
    setUploadState({ status: 'uploading', filename: file.name });
    const formData = new FormData();
    formData.append('file', file);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Upload failed');
      setUploadState({ status: 'success', docId: json.id });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setUploadState({
          status: 'error',
          message: 'Processing took too long. Please retry with a smaller/clearer file.',
        });
      } else {
        setUploadState({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleClose = () => {
    if (uploadState.status === 'success') router.refresh();
    setStartedAt(null);
    setElapsedMs(0);
    setUploadState({ status: 'idle' });
    onClose();
  };

  const goToDocument = () => {
    if (uploadState.status === 'success') {
      router.push(`/documents/${uploadState.docId}`);
      handleClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>

        {uploadState.status === 'idle' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`mt-2 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
              dragOver
                ? 'border-primary/60 bg-primary/10'
                : 'border-border/70 hover:border-border'
            }`}
          >
            <label className="cursor-pointer flex flex-col items-center gap-3">
              <div className="grid size-12 place-items-center rounded-2xl bg-muted/40 ring-1 ring-inset ring-foreground/10">
                <Upload className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <span className="text-primary font-medium">Click to upload</span>
                <span className="text-muted-foreground"> or drag & drop</span>
              </div>
              <p className="text-xs text-muted-foreground">PDF, PNG, JPG, CSV, TXT</p>
              <input type="file" accept={ACCEPTED} className="hidden" onChange={handleChange} />
            </label>
          </div>
        )}

        {uploadState.status === 'uploading' && (
          <div className="flex flex-col gap-4 py-7">
            <div className="flex items-start gap-3">
              <div className="grid size-11 place-items-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-primary/20">
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium truncate">{uploadState.filename}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.max(0, Math.round(elapsedMs / 1000))}s
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {statusLabel} Longer screenshots can take a bit more.
                </p>
              </div>
            </div>

            <div className="h-2 w-full rounded-full bg-muted/60 ring-1 ring-inset ring-foreground/10 overflow-hidden relative">
              <div className="absolute inset-0 opacity-70 bg-[linear-gradient(to_right,transparent,oklch(0.92_0_0_/_0.35),transparent)]"
                   style={{ animation: 'shimmer-x 1.1s infinite' }} />
              <div className="h-full w-full bg-gradient-to-r from-primary/40 via-primary/20 to-primary/40 opacity-40" />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {([
                ['Upload', true],
                ['OCR', elapsedMs >= 3_000],
                ['Parse', elapsedMs >= 7_500],
                ['Save', elapsedMs >= 12_000],
              ] as const).map(([label, active]) => (
                <div
                  key={label}
                  className={[
                    'flex items-center justify-between rounded-lg px-3 py-2 ring-1 ring-inset',
                    active ? 'bg-primary/10 ring-primary/20 text-foreground' : 'bg-muted/30 ring-foreground/10 text-muted-foreground',
                  ].join(' ')}
                >
                  <span className="font-medium">{label}</span>
                  <span className="text-[10px] uppercase tracking-wide">{active ? 'running' : 'queued'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {uploadState.status === 'success' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="h-12 w-12 text-emerald-300" />
            <p className="text-base font-medium">Document processed successfully</p>
            <p className="text-sm text-muted-foreground">Review and validate the extracted data.</p>
            <div className="flex gap-3 w-full">
              <Button variant="outline" className="flex-1" onClick={handleClose}>Back to Dashboard</Button>
              <Button className="flex-1" onClick={goToDocument}>Review Document</Button>
            </div>
          </div>
        )}

        {uploadState.status === 'error' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <AlertCircle className="h-12 w-12 text-rose-300" />
            <p className="text-base font-medium">Processing failed</p>
            <p className="text-sm text-rose-300 text-center">{uploadState.message}</p>
            <div className="flex gap-3 w-full">
              <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
              <Button className="flex-1" onClick={() => setUploadState({ status: 'idle' })}>Try Again</Button>
            </div>
          </div>
        )}

        {(uploadState.status === 'idle') && (
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground font-medium">Supported file types</p>
            <div className="flex flex-wrap gap-2">
              {[['PDF', ''], ['PNG / JPG', ''], ['CSV', ''], ['TXT', '']].map(([label]) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground ring-1 ring-inset ring-foreground/10"
                >
                  {label.includes('PNG') ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
