import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

type LiveEvent =
  | { type: 'scan.updated'; scanId: number }
  | { type: 'conversation.updated'; conversationId: number }
  | { type: 'message.updated'; conversationId: number; messageId: number }
  | { type: 'campaign.updated'; campaignId: number }
  | { type: 'opportunity.updated'; opportunityId: number }
  | { type: 'wa.session'; status: string }
  | { type: 'validation.updated' };

const EVENT_TYPES = ['scan.updated', 'conversation.updated', 'message.updated', 'campaign.updated', 'opportunity.updated', 'wa.session', 'validation.updated'];

const EVENT_QUERIES: Record<LiveEvent['type'], string[]> = {
  'scan.updated': ['scans', 'leads', 'attention', 'metrics'],
  'conversation.updated': ['inbox', 'attention', 'metrics'],
  'message.updated': ['inbox', 'attention', 'metrics'],
  'campaign.updated': ['campaigns', 'leads', 'metrics'],
  'opportunity.updated': ['opportunities', 'leads', 'attention', 'metrics'],
  'wa.session': ['wa-session'],
  'validation.updated': ['leads', 'metrics'],
};

function createInvalidationBatch(qc: QueryClient) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    add(keys: string[]) {
      for (const key of keys) pending.add(key);
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        for (const key of pending) void qc.invalidateQueries({ queryKey: [key] });
        pending.clear();
      }, 250);
    },
    clear() {
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}

export function useLiveUpdates(): 'connecting' | 'open' | 'closed' {
  const qc = useQueryClient();
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  useEffect(() => {
    const es = new EventSource('/api/events');
    const batch = createInvalidationBatch(qc);
    let opened = false;
    es.onopen = () => {
      setState('open');
      if (opened) {
        batch.clear();
        void qc.invalidateQueries();
      }
      opened = true;
    };
    es.onerror = () => setState(es.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    const handler = (e: MessageEvent<string>) => {
      let evt: LiveEvent;
      try {
        evt = JSON.parse(e.data) as LiveEvent;
      } catch {
        return;
      }
      if (!evt || !EVENT_TYPES.includes(evt.type)) return;
      batch.add(EVENT_QUERIES[evt.type]);
    };
    for (const t of EVENT_TYPES) es.addEventListener(t, handler as EventListener);
    return () => {
      batch.clear();
      for (const t of EVENT_TYPES) es.removeEventListener(t, handler as EventListener);
      es.close();
    };
  }, [qc]);
  return state;
}
