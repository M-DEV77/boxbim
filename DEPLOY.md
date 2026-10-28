# BoxBim numa VPS com Easypanel

O BoxBim roda como um app Docker (o `Dockerfile` está na raiz). Os dados — banco SQLite, objetos, tipos, memórias
da IA e a chave que cifra as chaves de API — ficam na pasta `/data`, que precisa ser um **volume** (senão somem a
cada atualização).

## 1. Código no GitHub
O Easypanel puxa o código de um repositório Git. Crie um repositório **privado** e envie este projeto:

```bash
git remote add origin https://github.com/<você>/boxbim.git
git push -u origin main
```

## 2. App no Easypanel
1. **Create › App** (dentro de um projeto do Easypanel).
2. **Source › GitHub**: escolha o repositório e o branch. **Build › Dockerfile** (caminho `Dockerfile`).
3. **Environment** — cole e ajuste (modelo em `.env.example`):
   ```
   PORTA=3000
   BOXBIM_DATA=/data
   BOXBIM_HTTPS=1
   BOXBIM_PROXY=1
   BOXBIM_REMOTO=1
   BOXBIM_CODIGO_CADASTRO=um-codigo-so-seu
   ```
4. **Mounts › Add Volume**: nome `boxbim-dados`, mount path **`/data`**.
5. **Domains**: adicione o domínio (ex.: `bim.suaempresa.com.br`) apontando para a **porta 3000**, com HTTPS
   (o Easypanel emite o certificado). O BoxBim usa WebSocket (`/ws`) para a edição em tempo real — o proxy do
   Easypanel já repassa.
6. **Deploy**. A verificação de saúde é `GET /api/saude`.

## 3. Primeiro acesso
- Abra o domínio e **crie a primeira conta: ela vira a de administrador** (não pede o código de cadastro).
  Faça isso logo depois do primeiro deploy.
- As outras pessoas criam conta com o `BOXBIM_CODIGO_CADASTRO` (sem essa variável, qualquer um que acessar o
  domínio pode criar conta).
- Em ⚙ Configurações, o administrador cadastra as chaves de API da IA (ficam cifradas em `/data`).

## O que muda na nuvem (`BOXBIM_REMOTO=1`)
- Revit, Blender e o acesso a pastas do computador ficam desligados: são do computador onde o BoxBim
  roda. Para usar o Revit, rode o BoxBim também no Windows (`BoxBim.cmd`) e troque arquivos IFC/DWG.
- Importar/exportar IFC, DXF, glTF, OBJ, STL, Collada e FBX (o FBX sai pelo Blender só no modo local) funcionam
  pelo navegador.

## IA local (LM Studio, Ollama) com o BoxBim na VPS
O LM Studio roda no **seu** computador; a VPS não o alcança. O BoxBim resolve isso chamando a IA local **pelo
navegador** (que está no seu computador) sempre que o servidor está em `BOXBIM_REMOTO=1` e o endereço do provedor é
local (localhost, 127.0.0.1, 192.168.x…). Para funcionar:
- **LM Studio**: Developer › Start Server e, em Server Settings, ligue **Enable CORS**.
- **Ollama**: defina a variável `OLLAMA_ORIGINS=*` (ou o seu domínio) e reinicie o Ollama.
- Se o navegador perguntar se o site pode **acessar dispositivos da rede local**, permita.
- Servidor de IA em outra máquina da rede (ex.: `http://192.168.0.10:1234`): acrescente o endereço em
  `BOXBIM_CONNECT_SRC` (separados por espaço).

## MCP
- **BoxBim como servidor MCP**: endereço `https://SEU-DOMINIO/mcp`. Cada usuário gera o próprio token em
  ⚙ Configurações › MCP e copia o comando pronto:
  ```bash
  claude mcp add --transport http boxbim https://SEU-DOMINIO/mcp --header "Authorization: Bearer bbx_…"
  ```
  No Claude Desktop, a configuração com `mcp-remote` também aparece pronta para copiar.
- **Chat IA usando servidores MCP**: o administrador cadastra em ⚙ Configurações › MCP (URL + token). Servidores no
  computador de quem usa: marque "No meu computador" (o navegador chama; o servidor MCP precisa aceitar CORS).

## Atualizar
Envie os commits para o GitHub e clique **Deploy** (ou ligue o deploy automático). O volume `/data` é mantido.

## Backup
Copie o volume `/data` (por exemplo, com o backup de volumes do Easypanel). O arquivo principal é
`/data/.servidor/boxbim.sqlite`; `/data/.servidor/segredo.key` é necessário para ler as chaves de API salvas.

## Variáveis
| Variável | Padrão | Para quê |
|---|---|---|
| `PORTA` | 3000 | porta HTTP dentro do contêiner |
| `HOST` | 0.0.0.0 | interface |
| `BOXBIM_DATA` | `/data` (na imagem) | pasta de dados (volume) |
| `BOXBIM_HTTPS` | — | `1`: cookie de sessão só por HTTPS (use com domínio HTTPS) |
| `BOXBIM_PROXY` | `1` (na imagem) | confia no `X-Forwarded-For` do proxy |
| `BOXBIM_REMOTO` | `1` (na imagem) | desliga recursos do computador local |
| `BOXBIM_CODIGO_CADASTRO` | — | código exigido para criar conta |
| `BOXBIM_CONNECT_SRC` | — | endereços extras que o navegador pode chamar (IA/MCP na rede interna) |
| `BOXBIM_DEMO` | — | `0`: sem a demonstração na entrada (o visitante vai direto ao login) |
| `BOXBIM_DEMO_MIN` | 5 | minutos da demonstração antes de o login cobrir a tela |

---
<a href="https://marceloolimpio.com.br/">BoxHoney By Marcelo Olimpio – Eng. de software v2.50.0</a>
