import { Badge } from '@/components/ui/badge'
import { STATE_LABEL, type SwapState } from '@/lib/swaps'

const TONE: Record<SwapState, 'ok' | 'warn' | 'muted' | 'default'> = {
  DRAFT: 'muted',
  PENDING_PEER: 'warn',
  PEER_AGREED: 'default',
  PENDING_MANAGER: 'warn',
  APPROVED: 'ok',
  REJECTED: 'muted',
  CANCELLED: 'muted',
}

/** Lifecycle badge with a Polish label + tone matching the design system. */
export function SwapBadge({ state }: { state: SwapState }) {
  return <Badge tone={TONE[state]}>{STATE_LABEL[state]}</Badge>
}
