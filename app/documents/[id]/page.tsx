'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Document, DocumentStatus, LineItem, ValidationIssue } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { DOC_TYPE_LABELS, STATUS_LABELS } from '@/lib/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, XCircle, Save, RefreshCw, Trash2, Plus
} from 'lucide-react';

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) return (
    <div className="flex items-center gap-2 text-emerald-300 text-sm py-2">
      <CheckCircle2 className="h-4 w-4" />
      No validation issues detected
    </div>
  );
  return (
    <ul className="space-y-2">
      {issues.map((issue, i) => (
        <li
          key={i}
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
            issue.severity === 'error'
              ? 'bg-rose-500/10 text-rose-200 ring-rose-400/20'
              : 'bg-amber-500/10 text-amber-200 ring-amber-400/20'
          }`}
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span><strong>{issue.field}:</strong> {issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

export default function DocumentReview() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Editable fields
  const [docType, setDocType] = useState('');
  const [supplier, setSupplier] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [subtotal, setSubtotal] = useState('');
  const [tax, setTax] = useState('');
  const [total, setTotal] = useState('');
  const [notes, setNotes] = useState('');

  const fetchDoc = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/documents/${id}`);
    const data: Document = await res.json();
    setDoc(data);
    setDocType(data.document_type ?? 'unknown');
    setSupplier(data.supplier ?? '');
    setDocNumber(data.document_number ?? '');
    setIssueDate(data.issue_date ?? '');
    setDueDate(data.due_date ?? '');
    setCurrency(data.currency ?? '');
    setLineItems(data.line_items ?? []);
    setSubtotal(data.subtotal?.toString() ?? '');
    setTax(data.tax?.toString() ?? '');
    setTotal(data.total?.toString() ?? '');
    setNotes(data.notes ?? '');
    setLoading(false);
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => {
      void fetchDoc();
    }, 0);
    return () => clearTimeout(t);
  }, [fetchDoc]);

  const handleSave = async (newStatus?: DocumentStatus) => {
    setSaving(true);
    const body = {
      document_type: docType || null,
      supplier: supplier || null,
      document_number: docNumber || null,
      issue_date: issueDate || null,
      due_date: dueDate || null,
      currency: currency || null,
      line_items: lineItems,
      subtotal: subtotal ? parseFloat(subtotal) : null,
      tax: tax ? parseFloat(tax) : null,
      total: total ? parseFloat(total) : null,
      notes: notes || null,
      ...(newStatus ? { status: newStatus } : {}),
    };
    const res = await fetch(`/api/documents/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const updated = await res.json();
    setDoc(updated);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: string) => {
    setLineItems(prev => {
      const updated = [...prev];
      if (field === 'description') {
        updated[index] = { ...updated[index], description: value };
      } else {
        updated[index] = { ...updated[index], [field]: value === '' ? null : parseFloat(value) };
      }
      return updated;
    });
  };

  const addLineItem = () => {
    setLineItems(prev => [...prev, { description: '', quantity: null, unit_price: null, total: null }]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== index));
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      <RefreshCw className="h-5 w-5 animate-spin mr-2" />
      Loading...
    </div>
  );

  if (!doc) return <div className="p-8 text-rose-300">Document not found</div>;

  const hasErrors = doc.validation_issues?.some(i => i.severity === 'error');

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/50">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => router.push('/')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{doc.filename}</div>
            <div className="text-xs text-muted-foreground">
              {DOC_TYPE_LABELS[doc.document_type ?? 'unknown']} · {doc.file_type.toUpperCase()}
            </div>
          </div>
          <StatusBadge status={doc.status} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {/* Validation issues */}
        <Card>
          <CardHeader className="border-b border-border/60">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Validation issues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <IssueList issues={doc.validation_issues ?? []} />
          </CardContent>
        </Card>

        {/* Document metadata */}
        <Card>
          <CardHeader className="border-b border-border/60">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Document details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Document Type</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v ?? '')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="invoice">Invoice</SelectItem>
                  <SelectItem value="purchase_order">Purchase Order</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Supplier / Company</Label>
              <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Supplier name" />
            </div>
            <div className="space-y-1.5">
              <Label>Document Number</Label>
              <Input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="e.g. INV-001" />
            </div>
            <div className="space-y-1.5">
              <Label>Issue Date</Label>
              <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Input value={currency} onChange={e => setCurrency(e.target.value)} placeholder="e.g. EUR, USD, BAM" />
            </div>
          </div>
          </CardContent>
        </Card>

        {/* Line items */}
        <Card>
          <CardHeader className="border-b border-border/60">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                Line items
              </CardTitle>
              <Button variant="outline" size="sm" onClick={addLineItem}>
                <Plus className="h-4 w-4 mr-1" />
                Add item
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">

          {lineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No line items. Click “Add item” to add one.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col />
                  <col className="w-20" />
                  <col className="w-28" />
                  <col className="w-28" />
                  <col className="w-10" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="py-2 pr-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</th>
                    <th className="py-2 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">Qty</th>
                    <th className="py-2 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">Unit price</th>
                    <th className="py-2 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">Total</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {lineItems.map((item, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-3">
                        <Input
                          value={item.description}
                          onChange={e => updateLineItem(i, 'description', e.target.value)}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          value={item.quantity ?? ''}
                          onChange={e => updateLineItem(i, 'quantity', e.target.value)}
                          className="h-8 text-sm text-right w-full tabular-nums"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          value={item.unit_price ?? ''}
                          onChange={e => updateLineItem(i, 'unit_price', e.target.value)}
                          className="h-8 text-sm text-right w-full tabular-nums"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          value={item.total ?? ''}
                          onChange={e => updateLineItem(i, 'total', e.target.value)}
                          className="h-8 text-sm text-right w-full tabular-nums"
                        />
                      </td>
                      <td className="py-2 pl-2">
                        <button
                          onClick={() => removeLineItem(i)}
                          className="grid size-8 place-items-center rounded-md text-muted-foreground/60 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                          aria-label="Delete line item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Separator />

          <div className="ml-auto grid max-w-sm grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Subtotal</Label>
              <Input type="number" value={subtotal} onChange={e => setSubtotal(e.target.value)} className="text-right" />
            </div>
            <div className="space-y-1.5">
              <Label>Tax</Label>
              <Input type="number" value={tax} onChange={e => setTax(e.target.value)} className="text-right" />
            </div>
            <div className="space-y-1.5">
              <Label>Total</Label>
              <Input type="number" value={total} onChange={e => setTotal(e.target.value)} className="text-right font-semibold" />
            </div>
          </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader className="border-b border-border/60">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add any notes or comments about this document..."
              rows={3}
            />
          </CardContent>
        </Card>

        {/* Action buttons */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button onClick={() => handleSave()} disabled={saving} variant="outline">
              {saving ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              {saved ? 'Saved!' : 'Save Changes'}
            </Button>

            {doc.status !== 'validated' && (
              <Button
                onClick={() => handleSave('validated')}
                disabled={saving}
                className="bg-emerald-500/90 text-emerald-50 hover:bg-emerald-500"
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Validate & Approve
              </Button>
            )}

            {doc.status !== 'rejected' && (
              <Button
                onClick={() => handleSave('rejected')}
                disabled={saving}
                variant="destructive"
              >
                <XCircle className="h-4 w-4 mr-1" />
                Reject
              </Button>
            )}

            {doc.status === 'validated' || doc.status === 'rejected' ? (
              <Button
                onClick={() => handleSave('needs_review')}
                disabled={saving}
                variant="outline"
              >
                Reset to Needs Review
              </Button>
            ) : null}

            <div className="ml-auto text-xs text-muted-foreground">
              Current status: <span className="font-medium">{STATUS_LABELS[doc.status]}</span>
              {hasErrors && (
                <span className="ml-2 text-rose-300">
                  · {doc.validation_issues.filter(i => i.severity === 'error').length} error(s)
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
