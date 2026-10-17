import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

/** Fronteira de erro das rotas: falhas de renderização não derrubam a aplicação inteira. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : 'Erro inesperado';
  return (
    <div role="alert" className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">Algo deu errado nesta tela</h1>
      <p className="mt-2 text-sm text-base-content/70">{message}</p>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          Recarregar
        </button>
        <Link to="/" className="btn btn-primary btn-sm">
          Ir para a visão geral
        </Link>
      </div>
    </div>
  );
}
