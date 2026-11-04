import { Badge } from '@astryxdesign/core/Badge';

const labels: Record<string, string> = {
  available: 'Available', unavailable: 'Unavailable', restricted: 'Restricted', unsupported: 'Unsupported',
  unknown: 'Unknown', unverified: 'Unverified', ready: 'Ready', partial: 'Partial', blocked: 'Blocked',
  not_configured: 'Not configured', permission_required: 'Permission required', error: 'Error',
  success: 'Success', skipped: 'Skipped', failed: 'Failed', allowed: 'Allowed', not_allowed: 'Not allowed',
};

export function StatusBadge({ status }: { status: string }) {
  const variant = status === 'failed' || status === 'error' ? 'error'
    : status === 'partial' || status === 'permission_required' ? 'warning'
    : status === 'ready' ? 'success' : 'neutral';
  return <Badge label={labels[status] ?? status} variant={variant} />;
}
