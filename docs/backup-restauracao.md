# Backup, restauração e migração

## O que é guardado

| Item | Onde | Observação |
| --- | --- | --- |
| Dados do aero | banco `aero` | leads, campanhas, mensagens, oportunidades, auditoria |
| Sessão do WhatsApp | banco `wa_gateway` (`AuthState`) | **credenciais**: quem tiver o backup pode usar seu WhatsApp |
| Anexos enviados | volume `aero_aero_media` | |
| Mídias/arquivos do gateway | volumes `aero_wa_media`, `aero_wa_uploads`, `aero_wa_data` | |
| Configuração | `.env` | não está no backup automático; guarde à parte, cifrado |

Redis (filas) e o volume do scraper não precisam de backup: as filas são reconstruídas a partir do MySQL (outbox, webhooks pendentes, varreduras ativas).

## Backup

```bash
bash infra/scripts/backup.sh
```

Gera `backups/<data>/` com `aero.sql.gz`, `wa_gateway.sql.gz`, `.tgz` dos volumes, `MANIFEST` (commit, migrations, imagem do gateway) e `SHA256SUMS`. A pasta `backups/` é ignorada pelo Git. **Cifre e guarde fora da máquina** (ex.: `age`/`gpg` + armazenamento externo).

## Verificar um backup (sem alterar nada)

```bash
bash infra/scripts/restore.sh backups/<data> --verify
```

Confere checksums, importa os dois dumps em bancos temporários, conta tabelas/linhas, testa os arquivos e descarta tudo.

Verificado em 17/10/2026 no ambiente local: backup gerado; `--verify` restaurou `aero` (24 tabelas, 1208 linhas — inclui dados de demonstração) e `wa_gateway` (19 tabelas) e validou os 4 arquivos de volume. A restauração com `--apply` **não** foi executada sobre os dados locais.

## Restaurar (substitui os dados atuais)

```bash
bash infra/scripts/restore.sh backups/<data> --apply
```

Pede confirmação, para `api`, `worker`, `wa-gateway` e `web`, importa os bancos, restaura os volumes e sobe tudo. Depois: **Configurações › Diagnóstico** e **Preparar sessão** se o webhook não estiver registrado.

## Migrar do computador para a VPS

1. No computador: `bash infra/scripts/backup.sh` e pare tudo (`docker compose down`) para não haver dois gateways usando a mesma sessão do WhatsApp.
2. Copie o repositório (mesmo commit), o `.env` e a pasta do backup para a VPS por canal seguro (`scp` pela tailnet).
3. Na VPS, siga [vps-tailscale.md](vps-tailscale.md) até subir o MySQL: `docker compose up -d mysql`.
4. `bash infra/scripts/restore.sh backups/<data> --apply`.
5. Ajuste `TS_HOSTNAME` e suba com a sobreposição da VPS.
6. Confira o diagnóstico. Se a sessão não reconectar, pareie novamente.

Nunca mantenha o gateway ativo nos dois lugares com a mesma sessão.
