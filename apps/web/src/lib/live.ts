import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Atualização em tempo real: a API envia sinais via SSE e a interface invalida
// as consultas afetadas. Se a conexão cair, o EventSource reconecta sozinho.

type LiveEvent =
  | { type: 'scan.updated'; scanId: number }
  | { type: 'conversation.updated'; conversationId: number }
  | { type: 'message.updated'; conversationId: number; messageId: number }
  | { type: 'campaign.updated'; campaignId: number }
  | { type: 'opportunity.updated'; opportunityId: number }
  | { type: 'wa.session'; status: string }
  | { type: 'validation.updated' };

const EVENT_TYPES = ['scan.updated', 'conversation.updated', 'message.updated', 'campaign.updated', 'opportunity.updated', 'wa.session', 'validation.updated'];

export function useLiveUpdates(): 'connecting' | 'open' | 'closed' {
  const qc = useQueryClient();
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setState('open');
    es.onerror = () => setState(es.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    const handler = (e: MessageEvent<string>) => {
      let evt: LiveEvent;
      try {
        evt = JSON.parse(e.data) as LiveEvent;
      } catch {
        return;
      }
      switch (evt.type) {
        case 'scan.updated':
          void qc.invalidateQueries({ queryKey: ['scans'] });
          void qc.invalidateQueries({ queryKey: ['leads'] });
          break;
        case 'conversation.updated':
        case 'message.updated':
          void qc.invalidateQueries({ queryKey: ['inbox'] });
          void qc.invalidateQueries({ queryKey: ['attention'] });
          break;
        case 'campaign.updated':
          void qc.invalidateQueries({ queryKey: ['campaigns'] });
          break;
        case 'opportunity.updated':
          void qc.invalidateQueries({ queryKey: ['opportunities'] });
          break;
        case 'wa.session':
          void qc.invalidateQueries({ queryKey: ['wa-session'] });
          break;
        case 'validation.updated':
          void qc.invalidateQueries({ queryKey: ['leads'] });
          break;
      }
    };
    for (const t of EVENT_TYPES) es.addEventListener(t, handler as EventListener);
    return () => es.close();
  }, [qc]);
  return state;
}
