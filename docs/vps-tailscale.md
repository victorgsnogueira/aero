# VPS da Hostinger com acesso privado pelo Tailscale

Objetivo: o aero (frontend e API, que estão atrás do mesmo Caddy) acessível **somente** pelos seus dispositivos autorizados na sua tailnet. Nenhuma porta do aero na internet pública.

> Instalar o Tailscale não fecha portas que continuem públicas. A proteção vem de **três** camadas: portas só em `127.0.0.1`, firewall negando entrada pública e política de acesso do Tailscale.

## 1. Preparar a VPS (Ubuntu 24.04)

```bash
sudo apt update && sudo apt -y upgrade
```

Instale o Docker Engine pelo repositório oficial (docs.docker.com/engine/install/ubuntu) e o Compose plugin. Instale o Tailscale:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

```bash
sudo tailscale up --ssh --advertise-tags=tag:aero-vps --hostname=aero-vps
```

Anote o nome MagicDNS (ex.: `aero-vps.tailnet-1234.ts.net`).

## 2. Política de acesso (console do Tailscale › Access controls)

Restrinja o acesso à sua identidade e ao servidor marcado:

```json
{
  "tagOwners": { "tag:aero-vps": ["seu-email@exemplo.com"] },
  "grants": [
    { "src": ["seu-email@exemplo.com"], "dst": ["tag:aero-vps"], "ip": ["tcp:443"] }
  ],
  "ssh": [
    { "action": "check", "src": ["seu-email@exemplo.com"], "dst": ["tag:aero-vps"], "users": ["root", "autogroup:nonroot"] }
  ]
}
```

Recomendado: aprovação de dispositivos (Device approval), 2FA na conta do provedor de identidade e chaves com expiração para a VPS (desative expiração só para ela, conscientemente).

## 3. Subir o aero

```bash
git clone https://github.com/victorgsnogueira/aero.git && cd aero
```

Copie seu `.env` (ou gere com `node infra/scripts/gen-secrets.mjs`) e acrescente:

```
TS_HOSTNAME=aero-vps.tailnet-1234.ts.net
```

```bash
docker compose -f docker-compose.yml -f infra/vps/compose.vps.yml up -d --build
```

A sobreposição mantém a única porta em `127.0.0.1:8080` e ajusta `ALLOWED_ORIGINS`/`ALLOWED_HOSTS` para o nome da tailnet.

## 4. Publicar só na tailnet

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
```

Não use `tailscale funnel` (expõe na internet). Acesse `https://aero-vps.tailnet-1234.ts.net` de um dispositivo autorizado.

## 5. Firewall

Na VPS:

```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing
```

```bash
sudo ufw allow in on tailscale0 && sudo ufw allow 41641/udp
```

```bash
sudo ufw enable
```

Depois de confirmar o acesso por `tailscale ssh`, remova SSH público (se houver regra `22/tcp`) e, no painel da Hostinger, configure o firewall da VPS para negar entrada exceto UDP 41641. Atenção: regras de portas publicadas pelo Docker ignoram o UFW — por isso nenhum serviço do compose publica em `0.0.0.0` (verificado pelo teste `routes.test.ts` e pelo job de CI).

Conferência externa (de fora da tailnet): `nmap -Pn <ip-público>` deve mostrar tudo fechado/filtrado.

## 6. Identidade e cabeçalhos

O aero não usa login nem confia em cabeçalhos de identidade. `tailscale serve` adiciona cabeçalhos como `Tailscale-User-Login`; se no futuro forem usados, só são confiáveis porque o Caddy recebe conexões exclusivamente do `tailscale serve` em loopback — nunca aceite esses cabeçalhos vindos de outra origem.

## 7. Recuperação de acesso

- Perdeu o dispositivo: remova-o no console do Tailscale e autorize outro.
- Tailscale fora do ar na VPS: use o **console web da VPS** no painel da Hostinger (hPanel › VPS › Terminal do navegador) e `sudo systemctl restart tailscaled` / `sudo tailscale up`.
- Conta do Tailscale inacessível: mantenha códigos de recuperação do provedor de identidade guardados offline.
- Último recurso: o console da Hostinger dá acesso local mesmo com o firewall fechado.

## Usar o Tailscale antes da VPS

Para acessar o aero do computador a partir do celular: instale o Tailscale no computador e no celular, rode `tailscale serve --bg --https=443 http://127.0.0.1:8080` no computador e acrescente no `.env`: `ALLOWED_ORIGINS_PROD=https://<nome-do-pc>.ts.net` e `ALLOWED_HOSTS_PROD=localhost,127.0.0.1,api,<nome-do-pc>.ts.net`; depois `docker compose up -d`.
