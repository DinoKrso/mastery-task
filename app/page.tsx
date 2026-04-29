'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Document } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { UploadModal } from '@/components/UploadModal';
import { DOC_TYPE_LABELS } from '@/lib/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Upload, FileText, AlertTriangle, CheckCircle2, XCircle, Clock, RefreshCw, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

const STATUS_ICONS = {
  uploaded: <Clock className="h-4 w-4 text-blue-300" />,
  needs_review: <AlertTriangle className="h-4 w-4 text-amber-300" />,
  validated: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
  rejected: <XCircle className="h-4 w-4 text-rose-300" />,
};

function formatDateOrDash(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'MMM d, yyyy');
}

export default function Dashboard() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocs(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void fetchDocs();
    }, 0);
    return () => clearTimeout(t);
  }, [fetchDocs]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this document?')) return;
    setDeletingId(id);
    await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    setDocs(prev => prev.filter(d => d.id !== id));
    setDeletingId(null);
  };

  const counts = {
    uploaded: docs.filter(d => d.status === 'uploaded').length,
    needs_review: docs.filter(d => d.status === 'needs_review').length,
    validated: docs.filter(d => d.status === 'validated').length,
    rejected: docs.filter(d => d.status === 'rejected').length,
  };

  const currencyTotals: Record<string, number> = {};
  docs.filter(d => d.status === 'validated' && d.currency && d.total).forEach(d => {
    currencyTotals[d.currency!] = (currencyTotals[d.currency!] ?? 0) + (d.total ?? 0);
  });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/50">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-primary/15 ring-1 ring-inset ring-primary/20">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">DocProcessor</div>
              <div className="text-xs text-muted-foreground">Smart document processing</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchDocs}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4 mr-1" />
              Upload
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Upload, review, validate, and export clean document data.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            {docs.length} document{docs.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {([
            ['uploaded', 'Uploaded', 'text-blue-200', 'bg-blue-500/10 ring-blue-400/20'],
            ['needs_review', 'Needs Review', 'text-amber-200', 'bg-amber-500/10 ring-amber-400/20'],
            ['validated', 'Validated', 'text-emerald-200', 'bg-emerald-500/10 ring-emerald-400/20'],
            ['rejected', 'Rejected', 'text-rose-200', 'bg-rose-500/10 ring-rose-400/20'],
          ] as const).map(([key, label, textColor, surface]) => (
            <div
              key={key}
              className={`rounded-xl p-4 ring-1 ring-inset ${surface}`}
            >
              <div className="mb-2 flex items-center gap-2">
                {STATUS_ICONS[key]}
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </span>
              </div>
              <p className={`text-2xl font-semibold tracking-tight ${textColor}`}>{counts[key]}</p>
            </div>
          ))}
        </div>

        {Object.keys(currencyTotals).length > 0 && (
          <Card>
            <CardHeader className="border-b border-border/60">
              <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                Validated totals
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-6">
              {Object.entries(currencyTotals).map(([currency, total]) => (
                <div key={currency} className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tracking-tight">
                    {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{currency}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/60">
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Documents</CardTitle>
              <span className="text-sm text-muted-foreground">{docs.length} total</span>
            </div>
          </CardHeader>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              Loading...
            </div>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <div className="grid size-12 place-items-center rounded-2xl bg-muted/40 ring-1 ring-inset ring-foreground/10">
                <FileText className="h-6 w-6" />
              </div>
              <p className="text-sm">No documents yet. Upload one to get started.</p>
              <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4 mr-1" />
                Upload Document
              </Button>
            </div>
          ) : (
            <div className="px-2 pb-2 sm:px-4">
              <Table className="rounded-lg">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Filename</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Doc #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Issues</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map(doc => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <Link
                          href={`/documents/${doc.id}`}
                          className="block max-w-[200px] truncate text-sm font-medium text-primary hover:underline"
                        >
                          {doc.filename}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {doc.document_type ? DOC_TYPE_LABELS[doc.document_type] : '—'}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-sm text-muted-foreground">
                        {doc.supplier ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm font-mono text-muted-foreground">
                        {doc.document_number ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateOrDash(doc.issue_date)}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {doc.total != null
                          ? `${doc.total.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${doc.currency ?? ''}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {doc.validation_issues?.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-300">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {doc.validation_issues.length}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-emerald-300">✓ None</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={doc.status} />
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => handleDelete(doc.id)}
                          disabled={deletingId === doc.id}
                          className="text-muted-foreground/70 hover:text-rose-300 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </main>

      <UploadModal open={uploadOpen} onClose={() => { setUploadOpen(false); fetchDocs(); }} />
    </div>
  );
}
