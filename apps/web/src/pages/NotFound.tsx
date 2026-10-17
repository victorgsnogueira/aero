import { Link } from 'react-router';
import { EmptyState } from '../components/ui';

export default function NotFound() {
  return <EmptyState title="Página não encontrada" action={<Link to="/" className="btn btn-sm">Voltar à visão geral</Link>} />;
}
