import { DocumentStatus } from './types';

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  uploaded: 'Uploaded',
  needs_review: 'Needs Review',
  validated: 'Validated',
  rejected: 'Rejected',
};

export const STATUS_COLORS: Record<DocumentStatus, string> = {
  uploaded: 'bg-blue-500/15 text-blue-200 ring-1 ring-inset ring-blue-400/25',
  needs_review: 'bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-400/25',
  validated: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-inset ring-emerald-400/25',
  rejected: 'bg-rose-500/15 text-rose-200 ring-1 ring-inset ring-rose-400/25',
};

export const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  purchase_order: 'Purchase Order',
  unknown: 'Unknown',
};
