# BoxBim

Modelagem BIM no navegador, em equipe, com chat de IA e ponte com o Revit 2025.

**Versão 2.17.0** · add-in BoxBim Bridge **1.1.0** · histórico completo em [CHANGELOG.md](CHANGELOG.md) · servidor na nuvem (Easypanel): [DEPLOY.md](DEPLOY.md) · arquitetura e histórico: [AGENT.MD](AGENT.MD).

## Rodar

Requer **Node 24** (usa o SQLite embutido no Node).

```
npm install
npm start            # empacota a interface e sobe o servidor em http://localhost:3000
```

Ou dê dois cliques em `BoxBim.cmd` (sobe o servidor e abre o navegador). Ao iniciar, o servidor mostra o
endereço da rede (ex.: `http://192.168.1.31:3000`) para os outros entrarem.

| Variável | Padrão | Para quê |
|---|---|---|
| `PORTA` | 3000 | porta do servidor |
| `HOST` | 0.0.0.0 | interface (use 127.0.0.1 para só este PC) |
| `BOXBIM_DATA` | `Documentos\BoxBim` | pasta de dados (agentes, skills, memória; banco em `.servidor/`) |
| `BOXBIM_HTTPS` | — | `1` atrás de HTTPS (cookie Secure) |

**Na internet**: rode atrás de um proxy HTTPS (`BOXBIM_HTTPS=1`). Revit e "abrir pasta" só funcionam
quando o navegador está no próprio computador do servidor; Blender e ODA convertem no servidor para todos.

## Contas, projetos e equipe

Para recomeçar as contas (esqueceu a senha do administrador, e-mail digitado errado…):
`npm run zerar-contas -- --sim` apaga contas, sessões e projetos (a biblioteca de objetos fica) e guarda uma
cópia do banco em `<dados>/.servidor/backup-<data>/`; a próxima conta cadastrada vira administradora. Sem
`--sim` o comando só mostra o que seria apagado.


- **Cadastro e login** em `/login.html`. A primeira conta é a **administradora** (chaves de IA e caminhos das
  ferramentas, em ⚙ Configurações).
- **Projetos** (`/projetos.html`): meus e compartilhados comigo, com miniatura. Cada projeto tem um **dono**,
  que convida pelo e-mail como **editor** (modela junto) ou **leitor** (só vê).
- **Tempo real**: o que um faz aparece na hora para os outros (avatares no topo; a seleção de cada um aparece
  na cor dele). Tudo é gravado no banco a cada alteração — não existe "salvar".
- Projeto novo começa só com o **Nível 0**.
- **Ambientes e camadas** (Modelar › Ambientes): o dono cria ambientes (Arquitetura, Estrutura…) com camadas
  (Arquitetura › Paredes…) e escolhe os desenhos de cada camada. Elementos novos caem na camada certa; cada
  camada pode ser ocultada ou travada. No Compartilhar, o botão **Camadas** libera uma ou mais camadas para cada
  participante: ele vê tudo, mas só edita as liberadas (o servidor confere, inclusive pelo MCP).

## Banco de dados

SQLite em `<dados>/.servidor/boxbim.sqlite`, pelo ORM **Sequelize** (`server/db/index.js`):

| Tabela | O quê |
|---|---|
| `usuarios`, `sessoes` | contas e sessões de login |
| `projetos`, `membros` | projetos (níveis, grade, cores, tipos e ambientes em `dados`) e participantes com papel e camadas liberadas |
| `elementos` | um registro por elemento do projeto (GUID, tipo IFC, dados de modelagem) |
| `objetos`, `objetos_projeto` | biblioteca geral (com preço, ícone, miniatura) e cópias por projeto |
| `config`, `ferramentas` | tipos/materiais gerais e os conjuntos de ferramentas de cada usuário |

## Formatos

| Formato | Importar | Exportar | Como |
|---|---|---|---|
| RVT | ✔ | ✔ | Ponte com o Revit (add-in) — o Revit converte via IFC |
| IFC | ✔ | ✔ (IFC4) | web-ifc / exportador próprio (IfcTriangulatedFaceSet + cores + Psets) |
| DWG | ✔ | ✔ | ODA File Converter (gratuito) ou pelo Revit (`Revit › exportar projeto ativo`) |
| DXF | ✔ | ✔ | dxf-parser / escritor R12 próprio |
| FBX | ✔ | ✔ | FBXLoader / Blender (detectado automaticamente) |
| COLLADA (.dae) | ✔ | ✔ | ColladaLoader / exportador próprio (Z_UP, metros) |
| glTF, OBJ, STL | ✔ | ✔ | three.js |

Arraste arquivos para a vista 3D ou use **Importar** / **Ctrl+O**.

## Níveis e vistas (como no Revit)

- **Navegador de projeto** (à esquerda): Vistas 3D, Plantas de piso e Plantas de forro (uma por nível),
  Elevações Norte/Sul/Leste/Oeste e a lista de Níveis (+ Nível, ✎ editar, ✕ apagar).
- Cada vista abre numa **aba** com a própria câmera. Plantas e elevações são estáticas (ortográficas: só pan
  e zoom) em fundo de papel, com contornos.
- **Planta de piso**: corta no plano de corte (padrão 1,20 m) e mostra até a profundidade (−0,30 m); o que é
  cortado recebe preenchimento escuro (tampa por stencil, funciona com sólidos sobrepostos).
- **Planta de forro**: vista de baixo, espelhada para manter a orientação da planta.
- **Elevações**: linhas e cabeças de nível com nome e cota, alternando de lado quando os níveis estão próximos.
- **Editar níveis em todas as vistas**: nas elevações e na Vista 3D (contorno tracejado em cada cota), arraste a
  linha para mudar a cota — os elementos do nível vão junto (Shift: só a linha; Ctrl: passo de 10 cm) — e clique
  duas vezes para editar nome/cota ou apagar. Em qualquer vista, o botão **NÍVEIS** do rodapé abre a tabela de níveis.
- **Fixar nível (🔒)**: nível fixado não muda de cota (nem arrastando) até destravar — no diálogo do nível ou na tabela.
- **Eixos de trabalho** (Desenho › Eixo de trabalho): planos de desenho verticais (dois cliques, ou origem e ângulo) ou
  horizontais (numa cota). Com um eixo ativo, o desenho 2D (linha, retângulo, círculo, aparar, estender, canto) é no
  plano dele e Extrudar levanta na normal dele. "Olhar para o eixo" põe a Vista 3D de frente para ele.
- **Edição pelos pontos**: linha, parede ou viga selecionada mostra a cota com a medida e dois pontos nas pontas —
  arraste os pontos (snap e ORTO) ou clique na medida para digitar o comprimento.
- **Estilo das linhas 2D**: tipo (contínua, tracejada, pontilhada, traço e ponto…), espessura por pena (mm) e cor —
  no painel de propriedades (uma ou várias linhas) e na barra da ferramenta de desenho (linhas novas).
- **Unidade** (m, cm, mm) no rodapé: exibição e digitação de comprimentos no projeto todo (os dados ficam em metros).
- **Grade infinita** em todas as vistas; o botão **GRADE** do rodapé oculta/mostra (só para você).
- **Chat IA na barra inferior**, recolhível (▾ ou Ctrl+J) e com altura ajustável pela borda de cima.
- **Editor de objetos com desenho 2D**: a barra "2D" da prévia tem Linha, Retângulo, Círculo, Seleção, Aparar,
  Estender, Canto, Extrudar, Varrer e Eixo de trabalho, nos planos XY/XZ/YZ ou em eixos de trabalho — tudo vira
  código (`g.line`, `g.circle`, `g.extrude`, `g.sweep`, `g.workplane`); `{ vazio: true }` corta as peças do objeto.
- **Varrer**: perfil = contorno 2D fechado desenhado (de preferência num eixo de trabalho perpendicular ao início do
  caminho, onde fica na posição desenhada), selecionado junto com o caminho.
- **Parede**: opções no painel da direita; desenhe com cliques ou **por linha de referência** (clique numa linha 2D),
  com a linha de localização no **centro**, na **parte interna** ou na **parte externa**.
- **Cantos das paredes em meia-esquadria** ao criar paredes encadeadas.
- **Linhas do sólido**: arestas (ou o contorno de uma face) dos sólidos viram linhas 2D.
- **Offset 2D** (O) para linhas, arcos, círculos e cadeias; **Offset 3D** para extrusões, varreduras, caixas e malhas.
- **Aparar, Estender, Canto (vivo, raio, chanfro) e Offset** também em paredes, vigas e canos (varreduras).
- **Junções em T** paradas na face da outra parede; **Ajustar junções** refaz tudo no projeto.
- **Piso das linhas** (contornos 2D fechados) e **piso do contorno da face** de um sólido.
- **Corte por nível** (plano de corte e profundidade da vista) e **eixos de trabalho** que acompanham os níveis.
- **Laje** por croqui 2D, linhas 2D, paredes (face externa/interna/eixo) ou face de sólido — contornos internos viram furos.
- **Copiar** (2D no plano do nível ou 3D sobre os sólidos), com repetições, para outro nível ou por distância.
- **Telhado**: perfil desenhado num eixo de trabalho vertical, extrudado; tipos de telhado com camadas (telha, ripas, caibros…).
- **Espelhar** por uma linha (2D ou 3D; vertical, horizontal ou perpendicular ao eixo de trabalho).
- **Parede até o telhado** (topo pela face de baixo do telhado) e **editar parede** com clique duplo (perfil de elevação).
- **MCP**: o BoxBim é um servidor MCP (`/mcp`, token em ⚙ › MCP) para Claude Desktop/Code; e o Chat IA usa
  ferramentas de servidores MCP externos.
- **IA local com o servidor na nuvem**: LM Studio/Ollama no seu computador são chamados pelo navegador (ligue o CORS).
- Sem nada selecionado, a aba Propriedades mostra a faixa da vista ativa (plano de corte, profundidade).
- Modelagem hospedada em nível: base/topo são deslocamentos a partir do nível e paredes/pilares vão até o
  nível de cima. O IFC exporta um `IfcBuildingStorey` por nível e importa os pavimentos como níveis.
- **Revit › Trazer níveis do Revit** lê os níveis do projeto ativo; **Enviar níveis ao Revit** cria os que
  faltam (com planta de piso) e atualiza a cota dos de mesmo nome (rota `/levels` do add-in).

## Mover, girar e orbitar

| Onde | Como |
|---|---|
| Projeto | **M** mover / **R** girar a seleção com o gizmo X/Y/Z (setas, planos, anéis); encaixe 0,05 m / 15° sobre o deslocamento (Ctrl = livre); ΔX ΔY ΔZ ou ângulo digitados; **Ctrl+Z** desfaz |
| Editor de Objetos | **V** selecionar / **M** mover / **R** girar peças: o código da linha que criou a peça é ajustado (`x: L / 2` → `x: L / 2 + 0.1`) |
| Vista 3D e prévia | widget de eixos no canto: clique numa ponta (±X/±Y/±Z) para olhar dali; ↺/↻ orbitam em torno de X, Y ou Z (Shift = 90°) |

Ao **selecionar** um elemento, o gizmo e a barra de mover aparecem sozinhos (no último modo usado) e somem ao
limpar a seleção — desligável pela caixa *Ao selecionar* da barra. Funciona na vista 3D, nas plantas de
piso e de forro de cada nível e nas elevações (nas plantas, só os eixos X/Y para mover e Z para girar). No editor de Objetos, clicar numa peça já
mostra o gizmo de mover.

**Pivô:** botão direito num ponto põe o pivô do gizmo ali (encaixa em quinas, meios de aresta e centros dos
elementos; senão, no ponto da superfície). **Alt + arrastar** o gizmo move só o pivô. O pivô acompanha o
elemento — útil para girar em torno de uma quina.

Paredes levam junto as portas e janelas hospedadas; uma porta movida sozinha volta ao eixo da parede.

## Desenhar paredes (como polilinha do AutoCAD)

Atalho **W**, ou faixa **Início › Modelar › Desenhar parede**. Funciona nas plantas e na vista 3D, no plano do
nível escolhido na barra de opções (Nível, Altura, Espessura, ORTO, Terminar, Sair).

| Ação | Como |
|---|---|
| Ponto inicial / próximo ponto | clique com o botão esquerdo (cada trecho vira uma parede) |
| **ORTO** (trava em 0°/90°) | `F8` liga/desliga · `Shift` inverte enquanto pressionado · botão ORTO na barra de status |
| Comprimento exato | aponte a direção com o cursor, digite o valor (ex.: `4,5`) e `Enter` |
| Snap de ponta | aproxime o cursor de uma ponta de parede (marcador laranja) |
| Fechar o contorno | `C` |
| Desfazer o último trecho | `Backspace` |
| Terminar a sequência | `Enter`, botão direito ou clique duplo |
| Sair da ferramenta | `Esc` (o primeiro `Esc` termina a sequência) |
| Arrastar / zoom | botão do meio / roda do mouse |

Os cantos das paredes encadeadas são fechados automaticamente (pontas prolongadas em meia espessura).

## Tipos com camadas

Paredes, pisos/lajes, pilares e vigas usam **tipos compostos** (como no Revit): cada camada tem material,
espessura e função. Edite em **faixa › Objetos › Tipos e camadas** (fica em `Documentos\BoxBim\tipos.json`);
ao salvar, todas as instâncias se atualizam. Nas plantas, o corte de cada camada usa a cor do material.
O tipo de um elemento pode ser trocado no painel Propriedades.

## Objetos (famílias paramétricas em JavaScript)

Um Objeto é uma lista de parâmetros + um script que gera a geometria. Crie em **faixa › Objetos › Novo objeto**:
escolha um ponto de partida (em branco, exemplo ou cópia da biblioteca) e o editor abre em **tela cheia**:

| Painel | O que faz |
|---|---|
| Parâmetros | cartões com controles ao vivo; ✎ edita a definição; ⤵ insere `p.<nome>` no código; selo *não usado* |
| Prévia 3D | vistas ISO/Frente/Topo/Lado, arame, cotas L × P × A, vão de portas/janelas; **clique numa peça → linha do código** |
| Código | cores, números de linha, erro marcado na linha, trechos prontos (Caixa, Extrusão, Revolução, Repetir…), console |

Tudo roda sozinho a cada alteração. `Ctrl+S` salva · `Ctrl+Enter` executa · `Ctrl+/` comenta · `Esc` fecha.
Renomear um parâmetro atualiza o código. Insira no projeto com o mouse (clique coloca, `R` gira, `Esc` sai);
os parâmetros de cada instância ficam editáveis em Propriedades.

```js
// p = parâmetros · g = geometria (metros, graus, Z para cima, origem = ponto de inserção)
g.box(p.largura, p.profundidade, p.espessura, { z: p.altura - p.espessura, material: p.material, name: 'Tampo' });
for (const sx of [-1, 1]) g.box(0.05, p.profundidade, p.altura - p.espessura, { x: sx * (p.largura / 2 - 0.05), material: 'Aço' });
g.log('área do tampo:', (p.largura * p.profundidade).toFixed(2), 'm²');
```

API: `g.box`, `g.cylinder`, `g.sphere`, `g.extrude` (planos `xy`/`xz`/`yz`, furos), `g.revolve`, `g.at`, `g.opening`, `g.object`, `g.log`.
O script roda isolado (Web Worker sem rede e sem acesso a arquivos ou ao app), com limite de 3 s.
Objetos ficam em `Documentos\BoxBim\objetos\*.bbo` e podem ser **exportados/importados** entre projetos.
O agente de IA também programa objetos (`save_object`) — veja a skill *objetos-parametricos*.

## Objetos de sistema (Parede, Laje, Pilar, Viga, Caixa)

As ferramentas da faixa **Modelar** criam elementos cuja geometria vem de objetos da biblioteca — **Parede**,
**Laje**, **Pilar**, **Viga** e **Caixa** — editáveis no editor de Objetos como qualquer outro. O elemento guarda
os dados de modelagem (eixo, contorno, tipo com camadas, vãos) e o script recebe:

| Em `p` | O quê |
|---|---|
| parâmetros dirigidos | `comprimento`, `altura`, `espessura`, `largura`, `profundidade`, `circular`… do elemento |
| `p.camadas` | `[{ nome, material, espessura, funcao }]` do tipo (vazio = genérico) |
| `p.perfis` | parede: elevação `[{ contorno, furos }]` já com os vãos de portas e janelas |
| `p.pontos` | laje: contorno em planta |

Parâmetros novos que você acrescentar (ex.: um capitel no Pilar) ficam por instância no painel Propriedades.
Salvar o objeto atualiza todos os elementos do tipo. Orto e Nível não são objetos.

## Objetos dentro de objetos (parâmetros compartilhados)

Um objeto pode conter outros objetos da biblioteca, como as famílias aninhadas do Revit:

```js
// dentro do "Pilar de concreto armado": cada barra é o objeto "Barra de aço"
g.object('Barra de aço', { comprimento: H - 2 * c }, { x, y, z: c });
```

Parâmetros de **mesmo nome** são **compartilhados**: o `diametro` e o `aco` do pilar passam sozinhos para todas as
barras; o que for informado no `{ … }` tem prioridade. No editor, **Inserir › Objeto ▾** escreve a chamada e a
seção **Objetos dentro deste** mostra o que é compartilhado (⇄), informado (=) ou padrão, com **Abrir** e
**Trazer parâmetros**. Mudar a Barra de aço atualiza os pilares que a usam, inclusive no modelo.

## Portas e janelas hospedadas

Portas e janelas (Objetos `IfcDoor`/`IfcWindow`, ou que chamam `g.opening`) são colocadas **em paredes**: na
inserção, a prévia gruda no eixo da parede sob o cursor e vira para o lado do cursor (`R` inverte); ao clicar,
o vão é aberto em todas as camadas. Em Propriedades ajustam-se o centro do vão (m do início da parede) e o lado.
Apagar a porta fecha o vão; apagar a parede apaga o que ela hospeda. No IFC, cada vão é um `IfcOpeningElement`
com `IfcRelVoidsElement` (parede) e `IfcRelFillsElement` (porta/janela).

```js
// vão de uma porta com marco: largura do vão luz + 2 marcos, altura + travessa
g.opening(p.largura + 2 * p.marco, p.altura + p.marco);
// janela a partir do peitoril
g.opening(p.largura, p.altura, { sill: p.peitoril });
```

Um parâmetro chamado `espessuraParede` recebe a espessura da parede hospedeira automaticamente.

## Menus, janelas e presets

- Todas as abas da faixa são suas (nenhuma é fixa): **+** ao lado das abas (ou ▦ › Personalizar menus) cria,
  renomeia, reordena e apaga abas e grupos e escolhe os comandos e objetos de cada grupo.
- **▦ Presets** (canto superior direito): cada preset guarda as abas e o arranjo das janelas (faixa e barras
  laterais recolhidas, largura, aba da direita). Troque, duplique, renomeie ou apague.
- **‹ ›** recolhem as barras da esquerda e da direita (Ctrl+[ / Ctrl+]); a alça na borda da vista as reabre.
  Ctrl+F1 recolhe a faixa.

## Desenho 2D, sólidos e vazios

| Comando | O que faz |
|---|---|
| Linha (L), Retângulo, Círculo (objetos) | desenho no plano do nível; snap em pontas/meios/centros; ORTO (F8); comprimento digitado |
| Seleção | clique; janela (arrastar →, inteiro dentro) ou cruzamento (arrastar ←, encosta) |
| Aparar (T) / Estender (E) | remove o trecho clicado entre cruzamentos / leva a ponta até a próxima linha |
| Canto | vivo, arredondado (raio) ou chanfro (distância + ângulo°) entre duas retas |
| Extrudar | contornos fechados selecionados → sólidos (furos internos vazados) |
| Varrer | perfil (retângulo, círculo ou desenhado) ao longo do caminho selecionado |
| Vazio + Cortar com vazio | sólido que corta as peças selecionadas; o furo acompanha os movimentos |

## Vistas: estilos, grade e projeção

Em **todas as vistas** (no rodapé, ao lado do status):

| Estilo | Como fica |
|---|---|
| Arame | só as linhas, tudo vazado |
| Projeto | desenho técnico: faces brancas, linhas pretas, fundo de papel, corte cinza |
| Colorido | uma cor por categoria (Vista › Cores do estilo Colorido…) |
| Transparente | as cores do Colorido, translúcidas — mostra o que está escondido |
| Render | materiais reais em tempo real (céu, sol, sombras; path tracing) |

Vistas 3D têm **Perspectiva/Ortogonal**. Grade e ponto base (0,0,0) aparecem em todas as vistas
(Vista › Espaçamento da grade…).

## Objetos: preço, ícone, biblioteca e ferramentas

- **Preço e ícone** de cada objeto (Biblioteca › Preço e ícone): preço por un, m, m², m³, kg, conjunto ou hora;
  ícone emoji ou imagem. Valem no projeto (cópia do projeto) ou na biblioteca geral.
- **Orçamento** (aba Objetos): quantidade × preço por objeto, com CSV. O painel Propriedades mostra preço,
  quantidade e total do elemento selecionado.
- **Biblioteca com miniaturas** no editor e em `/biblioteca.html`.
- **Ferramentas do usuário** (aba Minhas › Personalizar ferramentas): grupos com nome, com comandos e objetos
  escolhidos; aparecem no começo da aba Início. Parede, Laje, Pilar, Viga e Caixa são objetos — ficam no
  conjunto "Elementos" criado no primeiro acesso.

## Render (materiais em tempo real)

| Onde | O quê |
|---|---|
| Estilo **Render** (qualquer vista) | céu, sol (azimute/altura), sombras, oclusão ambiente, tonemapping; materiais PBR com texturas procedurais |
| Propriedades › **Materiais (render)** | cor, rugosidade, metal, vidro, normal, deslocamento, padrão e escala do material, ao vivo (grava nos tipos do projeto); **Mapas…** abre o editor |
| Vistas › **Materiais** (editor) | pré-visualização 3D e os mapas procedurais do padrão (concreto, reboco, tijolo, cerâmica, pastilha, madeira, ripado, metal, chapa perfurada, pedra, grama): **relevo (bump), normal, oclusão (AO), deslocamento** (paralaxe), **rugosidade/brilho**, **metal**, **especular** (intensidade e cor), **opacidade** (recorte de furos e vãos) e **emissão** (cor e intensidade) — cada mapa ligado/desligado e com intensidade |
| Qualidade › **Path tracing** | luz global progressiva para a imagem final; **Salvar imagem** grava o PNG |


## Ponte com o Revit 2025

```
powershell -ExecutionPolicy Bypass -File revit-addin\install-addin.ps1
```

Compila `revit-addin` contra `E:\Autodesk\Revit 2025` (use `-RevitDir` para outro local) e grava
`%APPDATA%\Autodesk\Revit\Addins\2025\BoxBimBridge.addin`. Ao abrir o Revit aparece a aba **BoxBim**;
a ponte escuta só em `127.0.0.1:48884`.

Rotas: `/status`, `/summary`, `/export` (ifc, dwg, dxf, fbx, obj, stl — do projeto ativo ou de um .rvt em
segundo plano), `/import` (vincular/importar ifc, rvt, dwg, dxf, obj, stl, skp, sat, step, 3dm), `/open`, `/ifc-to-rvt`.

O Revit não importa FBX nem COLLADA e não exporta COLLADA — o BoxBim cobre esses formatos e envia ao
Revit via IFC (vínculo, mantém categorias) ou DXF (geometria importada).

## IA

**⚙ Configurações › Provedores de IA**: Claude (Anthropic), OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek,
Mistral, xAI e locais — LM Studio (`:1234`), Ollama (`:11434`), llama.cpp `llama-server` (`:8080`) — além de
qualquer servidor compatível com OpenAI. Só o administrador altera; as chaves ficam no servidor, cifradas
(AES-256-GCM), e nunca vão para o navegador.

Tudo vive em `Documentos\BoxBim` (configurável):

```
agents/<agente>.md          frontmatter (provedor, modelo, temperatura, skills, ferramentas) + prompt de sistema
skills/<skill>/SKILL.md     name/description + instruções; o agente carrega com use_skill
memory/MEMORY.md            índice, injetado no contexto de cada conversa
memory/<memória>.md         uma memória por arquivo (user | feedback | project | reference)
chats/<data>-<título>.md    conversas salvas
```

Ferramentas do agente: cena (consultar, criar parede/laje/pilar/viga/caixa, modificar, apagar), arquivos
(importar/exportar qualquer formato), Revit (status, resumo, trazer, exportar, enviar) e memória.
Ações destrutivas e tudo que altera o Revit pedem confirmação no chat.

No console do navegador (F12): `app.runTool('scene_summary', {})` executa qualquer ferramenta manualmente.

## Estrutura

```
server/      servidor web: Express (páginas, API), WebSocket (tempo real), Sequelize + SQLite (db/),
             login (auth.js), projetos (projects.js), chamadas do editor (rpc.js), lib/ (IA, conversores,
             Revit, configurações)
renderer/    interface (three.js): app.html (editor), login.html, projetos.html, biblioteca.html;
             src/ é empacotado em dist/ pelo esbuild (src/web/api.js faz o papel do antigo Electron)
revit-addin/ add-in C# .NET 8 para Revit 2025
defaults/    agentes, skills e objetos de fábrica (entram no banco/pasta de dados na primeira execução)
assets/      ícone
```

---
<a href="https://marceloolimpio.com.br/">BoxHoney By Marcelo Olimpio – Eng. de software v2.19.1</a>
