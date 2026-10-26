# BoxBim — AGENT.MD (histórico e mapa do projeto)

Documento de referência para quem (pessoa ou agente de IA) vai trabalhar no BoxBim: como a aplicação se liga por
dentro e o histórico de cada commit. **Atualize a cada commit** (regra do `CLAUDE.md`).

## Mapa da arquitetura

O BoxBim é uma aplicação web: o **navegador** modela (three.js) e o **servidor** Node (Express + Sequelize/SQLite)
guarda os projetos, sincroniza a equipe em tempo real (WebSocket), executa conversões e fala com a IA e com o MCP.

```mermaid
flowchart LR
  subgraph NAV["Navegador (renderer/src)"]
    MAIN["web/main.js<br/>inicia o App"] --> APP["app.js<br/>App: faixa, painéis, atalhos"]
    APP --> VIEWER["viewer.js<br/>cena three.js, seleção, cortes"]
    APP --> DISPLAY["display.js<br/>chips de exibição, 👁 revelar ocultos,<br/>H/Shift+H, ajuda, gerenciador de elevações"]
    APP --> ORIGIN["origin-gizmo.js<br/>gizmo da origem 0,0"]
    APP --> DRAW2D["drawing.js<br/>escala das vistas, pesos de linha,<br/>linhas de corte"]
    DRAW2D --> VIEWER
    VIEWER --> HATCH["hatch.js<br/>hachuras do corte (shader)"]
    APP --> SDIMS["smart-dims.js<br/>cotas até peças paralelas"]
    DISPLAY --> VIEWER
    SDIMS --> VIEWER
    APP --> VIEWS["views.js / levels.js / levels-edit.js<br/>vistas, níveis, corte por nível"]
    APP --> RIB["ribbon.js / toolbars.js<br/>comandos, famílias ▾ e presets"]
    RIB --> ICONS["icons.js<br/>ícones nas cores da marca"]
    ICONS --> TABLER["icons-tabler.js<br/>Tabler Icons (MIT), gerado"]
    APP --> PANELS["panels.js<br/>Configurações, agentes, MCP"]
    APP --> CHAT["chat.js<br/>Chat IA (agentes)"]
    CHAT --> TOOLS["tools.js<br/>ferramentas do BoxBim p/ a IA"]
    APP --> PROJ["project.js<br/>ProjectSession: carrega e sincroniza"]
    APP --> ENVS["environments.js<br/>ambientes, camadas, permissões"]
    ENVS --> VIEWER
    PROJ --> ENVS
    APP --> MODEL["Ferramentas de modelagem"]
    MODEL --> DRAW["draw.js parede"]
    MODEL --> SLAB["slab-tool.js laje"]
    MODEL --> ROOF["roof-tool.js telhado"]
    MODEL --> WALLED["wall-edit.js editar parede / até o telhado"]
    MODEL --> COPY["copy-tool.js / mirror-tool.js<br/>copiar, espelhar"]
    MODEL --> SK["sketch/*<br/>linhas 2D, aparar, canto, offset,<br/>extrudar, varrer, vazios, lineares"]
    MODEL --> WP["workplanes.js eixos de trabalho"]
    MODEL --> TRANS["transform.js / grips.js<br/>mover, girar, pontos"]
    VIEWER --> ELEM["elements.js<br/>geometria nativa: parede, laje, pilar,<br/>viga, caixa, telhado (camadas, esquadria)"]
    ELEM --> SYS["objects/system.js<br/>objetos de sistema (scripts .bbo)"]
    SYS --> OBJ["objects/objects.js<br/>biblioteca, buildParts, vazios"]
    OBJ --> WORKER["objects/worker.js<br/>executa o script do objeto (sandbox)"]
    OBJ --> EDITOR["objects/editor.js + sketch2d.js<br/>editor de objetos com 2D"]
    APP --> IO["io/*<br/>IFC, DXF, glTF, Collada…"]
    APP --> RENDER["render.js<br/>vista Render, path tracing"]
    RENDER --> MATS["materials.js<br/>padrões procedurais, mapas,<br/>UVs em metros, paralaxe"]
    VIEWS --> RENDER
    APP --> MATED["material-editor.js<br/>editor com pré-visualização"]
    MATED --> MATS
    APP --> TEXED["texture-editor.js<br/>texturas próprias (camadas)"]
    TEXED --> MATS
    MATED --> TEXED
    TOOLS --> MATS
    DEMO["pages/demo.js (demo.html)<br/>Casa Horizonte para visitantes;<br/>login por cima após N min"] --> MATS
    API["web/api.js<br/>window.boxbim (RPC)"] --> LOCALAI["web/local-ai.js<br/>IA e MCP locais pelo navegador"]
    CHAT --> API
    PROJ --> API
    PANELS --> API
  end

  subgraph SRV["Servidor (server/)"]
    IDX["index.js<br/>Express, CSP, rotas, estático"] --> AUTH["auth.js<br/>login, cadastro, sessão"]
    IDX --> PROJS["projects.js<br/>projetos, membros, access()"]
    IDX -. "/ sem sessão → /demo.html; /api/demo (minutos)" .-> DEMO
    IDX --> RPC["rpc.js<br/>/api/rpc/&lt;canal&gt;"]
    IDX --> LIB["library.js<br/>biblioteca, ferramentas, presets"]
    IDX --> MCPS["mcp.js<br/>servidor MCP /mcp + tokens"]
    IDX --> RT["realtime.js<br/>WebSocket /ws (salas por projeto)"]
    RPC --> AI["lib/ai.js<br/>OpenAI-compat, Claude, Gemini"]
    RPC --> MCPC["lib/mcp-client.js<br/>cliente MCP (HTTP/SSE)"]
    RPC --> STORE["lib/store.js<br/>configurações, chaves cifradas,<br/>agentes, skills, memórias"]
    RPC --> CONV["lib/converters.js<br/>Blender, ODA (conversões)"]
    MCPS --> PROJS
    MCPS --> RT
    AUTH --> DB[("db/ SQLite<br/>Sequelize: Usuario, Projeto,<br/>Elemento, Objeto, TokenApi…")]
    PROJS --> DB
    RT --> DB
    LIB --> DB
    MCPS --> DB
  end

  API -- "HTTP /api/rpc" --> RPC
  PROJ -- "WebSocket /ws<br/>upsert / remove / projeto" --> RT
  RT -- "mudanças da equipe e do MCP" --> PROJ
  LOCALAI -. "fetch direto (CORS)" .-> LMS["LM Studio / Ollama<br/>no computador do usuário"]
  AI -. HTTPS .-> CLOUD["Claude, OpenAI, Gemini,<br/>OpenRouter…"]
  MCPC -. HTTP .-> EXTMCP["servidores MCP externos"]
  CLIENTMCP["Claude Desktop / Code<br/>(clientes MCP)"] -- "POST /mcp + token" --> MCPS
```

### Fluxos principais
- **Modelar**: ferramenta (ex.: `draw.js`) → `createOnLevel`/`elements.js` cria o elemento → `viewer.add` →
  `viewer.changed` → `project.js` envia `upsert` pelo `/ws` → `realtime.js` grava (`Elemento`) e repassa à equipe.
- **Objeto de sistema**: `rebuildElement` (nativo, imediato) → `system.build` roda o script do `.bbo` no
  `worker.js` → `buildParts` → malhas por camada (com esquadria, vãos, perfil próprio).
- **Chat IA**: `chat.js` → `B.ai.chat` → `rpc.js` → `lib/ai.js` (ou `local-ai.js` no navegador, quando a IA é
  local e o servidor está na nuvem) → chamadas de ferramenta → `tools.js` (BoxBim) ou `B.mcp.call` (MCP).
- **MCP (servidor)**: cliente MCP → `POST /mcp` (token) → `mcp.js` → banco + `realtime.notify` → aparece ao vivo.

## Commits

| Data | Versão | Hash | Resumo |
|---|---|---|---|
| 2026-10-23 | 2.14.0 | `c75dead` | Estado inicial do repositório (BoxBim web: modelagem, níveis, objetos, IA, Copiar, Telhado…) |
| 2026-10-23 | 2.14.1 | `1ed8e0e` | Pronto para VPS: Dockerfile, DEPLOY.md, `/api/saude`, `BOXBIM_PROXY/REMOTO/CODIGO_CADASTRO`; regra de commit |
| 2026-10-23 | 2.15.0 | `ac0a483` | Espelhar por uma linha (2D/3D), parede até o telhado, editor de parede com perfil (clique duplo) |
| 2026-10-23 | 2.15.0 | `f359b44` | DEPLOY.md: branch `main` |
| 2026-10-26 | 2.16.0 | `9a6ecb0` | IA local pelo navegador na VPS (LM Studio/Ollama); BoxBim como servidor MCP; Chat IA usando MCP externos |
| 2026-10-26 | 2.16.1 | `98b322e` | Regras do projeto (modelo de commit, AGENT.MD, créditos), créditos na lateral direita e na documentação, AGENT.MD |
| 2026-10-26 | 2.17.0 | `2deab17` | Retirada a conexão com o Unreal Engine; na nuvem o app não consulta mais o Revit (403); CSP corrigido |
| 2026-10-26 | 2.18.0 | `32edf3b` | Ambientes e camadas (`environments.js`); permissão por camada por participante, conferida no tempo real e no MCP |
| 2026-10-26 | 2.19.0 | `7b77756` | Sistema de materiais com mapas procedurais (`materials.js`, `material-editor.js`): bump, normal, AO, deslocamento, rugosidade/brilho, metal, especular, opacidade, emissão |
| 2026-10-26 | 2.19.1 | `edaed46` | Comandos novos (Ambientes, Materiais…) entram sozinhos nos presets de menus já gravados |
| 2026-10-26 | 2.20.0 | `1783e1e` | Estilo de vista Textura (`viewstyle.js` + `RenderMode.enableTextures`): materiais com mapas sem céu/sol/sombras |
| 2026-10-26 | 2.21.0 | `b751611` | Texturas procedurais próprias em camadas (`materials.js`, `texture-editor.js`), gravadas nos tipos do projeto; ferramentas do Chat IA `list_materials`, `create_texture`, `set_material` |
| 2026-10-26 | 2.22.0 | `f9450ed` | Entrada com demonstração (`demo.html` + `pages/demo.js`): Casa Horizonte com materiais procedurais, céu e sol; login por cima depois de `BOXBIM_DEMO_MIN` min |
| 2026-10-26 | 2.23.0 | `5304bfb` | Ferramentas parecidas em botões de família com ▾ (`ribbon.js`, presets convertidos em `toolbars.js`); ícones novos nas cores da marca (`icons.js`) |
| 2026-10-26 | 2.24.0 | `8e71a9e` | Mouse (direito seleciona/janela, Alt+direito gira), visibilidade central e 👁 revelar ocultos (`viewer.js`, `display.js`), cotas até peças paralelas (`smart-dims.js`), elevações próprias com profundidade e largura (`views.js`) |
| 2026-10-26 | 2.25.0 | `bd21d31` | Hospedagem por GUID (vínculo parede ↔ porta/janela sobrevive à reabertura; `repair` religa os antigos) e portas/janelas acompanham a parede (`hosting.follow`); arrastar marcadores de elevação nas plantas (`display.js`) |
| 2026-10-26 | 2.25.1 | `a7229b4` | `hosting.repair` conserta projetos antigos: porta deixada para trás volta para o vão (mesma medida e deslocamento); vão sem porta fecha |
| 2026-10-26 | 2.26.0 | `7aee41c` | Desfazer/refazer geral (`project.js`: passos do envio ao servidor) e botões ↶ ↷ no topo; troca de parede não apaga mais as portas hospedadas |
| 2026-10-26 | 2.27.0 | `5bbf141` | Acabamento visual pela skill high-end-visual-design: páginas (`pages.css`: vidro, moldura dupla, ilha, pílulas, entrada animada) e editor (`styles.css`: janelas, menus, barras, movimento de mola) |
| 2026-10-26 | 2.28.0 | `2fbf1f8` | Ícones genéricos da Tabler Icons (MIT) embutidos (`icons-tabler.js`, gerado por `scripts/gen-tabler-icons.py`); ícones de CAD próprios mantidos; `THIRD-PARTY-NOTICES.md` |
| 2026-10-26 | 2.29.0 | `44b4d48` | Gizmo da origem 0,0 (`origin-gizmo.js`, SVG de tamanho fixo; seta na borda quando fora da tela) |
| 2026-10-26 | 2.30.0 | `1a9f6dd` | Escala por vista e pesos de linha (`drawing.js`); arestas e linhas de corte com espessura real (LineSegments2/LineMaterial; `viewer.updateSectionLines`) |
| 2026-10-26 | 2.31.0 | este commit | Hachura nos materiais (`hatch.js`: padrões, shader da tampa do corte em coordenadas do modelo, prévia no editor) |

---
<a href="https://marceloolimpio.com.br/">BoxHoney By Marcelo Olimpio – Eng. de software v2.31.0</a>
