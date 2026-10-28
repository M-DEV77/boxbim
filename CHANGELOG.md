# Histórico de versões do BoxBim

Todas as mudanças relevantes do projeto ficam registradas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o
[Versionamento Semântico](https://semver.org/lang/pt-BR/): `MAIOR.MENOR.CORREÇÃO`.

| Componente | Versão atual | Onde aparece |
|---|---|---|
| BoxBim (aplicativo) | **2.52.2** | `package.json`, título da janela, indicador `v…` no canto inferior direito, ⚙ › Sobre |
| BoxBim Bridge (add-in do Revit 2025) | **1.1.0** | `revit-addin/BoxBimBridge.csproj`, campo `addin` da rota `/status` |
| Formato de Objeto (`.bbo`) | **1** | campo `version` de cada arquivo `.bbo` (a revisão de cada objeto fica em `revision`) |
| Formato de tipos (`tipos.json`) | **1** | campo `version` de `Documentos\BoxBim\tipos.json` |

---

## [2.52.2] — 2026-10-28 · Seleção individual das linhas do contorno

### Corrigido
- Na edição do contorno do piso, o clique numa linha não a selecionava quando havia uma superfície (terreno) na
  mesma cota: o clique agora atravessa o que está bloqueado pelo filtro de seleção e, no projeto todo, uma linha 2D
  no mesmo plano de uma superfície ganha dela no clique.

## [2.52.1] — 2026-10-28 · Seleção bloqueada na edição do piso

### Corrigido
- Editando o contorno do piso, clicar ou passar a janela selecionava outros elementos (ex.: o terreno): agora só as
  linhas do contorno podem ser selecionadas (e destacadas ao passar o mouse); ao concluir ou cancelar, a seleção
  volta ao normal (filtro de seleção no viewer).

## [2.52.0] — 2026-10-28 · Snap, cotas guias e correção do Offset

### Adicionado
- **Snap do projeto** (osnap.js): **ponta**, **meio** e **perpendicular** em linhas 2D, lados de pisos e furos,
  eixos de paredes e vigas — no desenho 2D (Linha, Retângulo, Círculo…), na Parede, nos pontos das linhas/paredes e
  dos pisos e na Cota. Marcador por tipo: quadrado (ponta), triângulo (meio), ⊥ (perpendicular).
- **Cotas guias** (guide-dims.js): na edição do contorno do piso, em todas as linhas; no projeto todo, nas linhas,
  paredes e vigas selecionadas (duas ou mais). Arraste para mudar a posição (guardada por elemento), clique no
  número para digitar o comprimento, duplo clique volta ao padrão.
- Linhas do contorno **selecionadas** mudam de cor (neon ciano).

### Corrigido
- **Offset** de contorno para dentro com um lado curto (ex.: chanfro menor que a distância) gerava um contorno
  cruzado: os trechos que somem no deslocamento saem e os vizinhos se encontram (offsetPolylineClean).

### Mudado
- Barras flutuantes das ferramentas na **vertical** (uma coluna), quadradas e menores.

## [2.51.1] — 2026-10-28 · Regra do idioma

### Documentação
- CLAUDE.md › **Idioma**: tudo sempre em português (Brasil) — respostas, resumos, commits, documentação, comentários
  e textos da interface.

## [2.51.0] — 2026-10-28 · Copiar contorno de piso

### Adicionado
- No **Editar contorno do piso**: **⧉ Copiar contorno de piso** — clique na face de outro piso e o contorno exato dele
  (e os furos) entra como linhas do esboço, na cota do piso em edição; vários cliques somam, Esc termina. Ponteiro
  próprio ("copiar-contorno").

## [2.50.0] — 2026-10-28 · Ponteiro de cada ferramenta

### Adicionado
- **Ponteiro próprio em cada ferramenta** (cursors.js): mira fina com folga no meio e o ponto exato do clique, mais o
  ícone da ferramenta em rosa — Aparar, Estender, Canto, Offset, Linha, Retângulo, Círculo, Linhas do sólido, Eixo de
  trabalho, Parede, Piso, Telhado, Cota, Copiar, Espelhar, Inserir objeto, ponto de forma, hospedeiro e Copiar linhas.
  Regra do projeto (CLAUDE.md › Interface): ferramenta nova sempre com o seu ponteiro.

### Mudado
- Barras flutuantes **quadradas e compactas** (cantos de 3 px, fonte e campos menores); a barra da **Cota** também
  flutua e é arrastável.

## [2.49.1] — 2026-10-28 · Ferramentas 2D no contorno do piso em qualquer cota

### Corrigido
- **Aparar, Estender, Canto, Offset…** não pegavam as linhas do contorno do piso (clique duplo) quando o topo do piso
  não estava na cota do nível (piso com deslocamento, terreno): durante a edição do contorno, o plano das ferramentas
  2D fica na cota das linhas do contorno e no nível do piso.

## [2.49.0] — 2026-10-28 · Copiar linhas e arestas no contorno do piso

### Adicionado
- No **Editar contorno do piso** (clique duplo): **⧉ Copiar linhas** — clique numa linha 2D do desenho e entram no
  contorno cópias dela e das ligadas a ela pelas pontas (as originais ficam); **⧉ Copiar arestas de sólidos** — usa
  "Linhas do sólido" projetando na planta: clique nas arestas (cantos) dos sólidos ou no contorno de uma face.
  Qualquer linha horizontal do esboço conta para o contorno, em qualquer cota.

### Mudado
- Neon do contorno do piso **mais fino e rosa** (no esboço e nos pontos de elevação).

## [2.48.0] — 2026-10-28 · Neon no contorno do piso e barras flutuantes

### Mudado
- As linhas do **esboço do contorno do piso** (clique duplo) aparecem em **neon** ciano — núcleo claro, brilho e halo
  por cima da vista — e o contorno dos pontos de elevação também (furos em magenta).
- As **barras das ferramentas** (Linha, Retângulo, Círculo, Aparar, Estender, Canto, Offset… e Mover/Girar) ficam
  **flutuando na vista** e podem ser **arrastadas** pela alça ⠿; cada barra guarda a posição e o duplo clique na alça
  a devolve ao lugar padrão (no alto, no meio, abaixo das abas das vistas).

## [2.47.0] — 2026-10-27 · Piso sobreposto

### Adicionado
- Opção **Sobrepor** no piso (Propriedades › Sobrepor; dado `slab.sobrepor.host`): ligue e clique no piso
  **hospedeiro** na vista (Esc cancela). O piso deita sobre o hospedeiro e **acompanha o relevo** dele — o fundo
  encosta na superfície de cima (a malha que está no modelo, com pontos de altura, taludes e cortes) e a espessura
  fica na vertical. Recalcula sozinho quando o hospedeiro muda ou se move.
- drape.js: superfície do hospedeiro por raio vertical acelerado (three-mesh-bvh); o sobreposto é feito depois
  dos outros cortes e não escava o terreno.

## [2.46.1] — 2026-10-27 · Sem a Edição 2D nas propriedades do piso

### Removido
- O bloco **Edição 2D do contorno** (canto e offset) das Propriedades do piso: o canto agora é a ferramenta **Canto**
  da faixa direto nos lados do piso, e o resto (offset, aparar, estender…) é pelo contorno em linhas 2D (clique duplo).

## [2.46.0] — 2026-10-27 · Canto da faixa no piso

### Adicionado
- A ferramenta **Canto** da faixa (Desenho) funciona nos **lados dos pisos** do nível: clique dois lados do mesmo
  contorno (ou do mesmo furo) — **vivo** estende os dois até se encontrarem (somem os lados do meio, do lado do
  canto, ex.: um arredondamento ou chanfro), **raio** arredonda e **chanfro** corta o canto. As alturas dos pontos
  acompanham.
- Os lados dos pisos também servem de limite para **Aparar** e **Estender** as linhas 2D.

## [2.45.0] — 2026-10-27 · Contorno do piso com linhas 2D

### Adicionado
- **Clique duplo no piso** (ou faixa › Piso › Editar contorno, ou Propriedades): o contorno e os furos viram
  **linhas 2D** na cota do topo e o piso some enquanto isso; as ferramentas 2D da faixa trabalham nelas (Linha,
  Aparar, Estender, Canto com raio/chanfro, Offset, Mover, Copiar…). **✔ Concluir** (Enter) refaz o piso com os
  contornos fechados (o maior é o piso, os de dentro são furos; arcos viram pontos) e **✖ Cancelar** (Esc) volta
  como estava. Pontos que já existiam mantêm a altura; os novos seguem a superfície do piso.
- As linhas do esboço ficam só na tela de quem edita (não vão para o servidor).

### Mudado
- Os **pontos de elevação** do piso aparecem com **dois cliques com uma pausa** no piso (ou Propriedades › Pontos de
  elevação); o clique simples só seleciona. O diálogo do piso continua em Propriedades › Diálogo do piso.

## [2.44.0] — 2026-10-27 · Ferramentas 2D na edição do piso

### Adicionado
- **Edição 2D do contorno** em Propriedades do piso, usada direto na vista:
  - **Canto** com **raio** (arco) ou **chanfro**: clique nos cantos do piso (contorno e furos); fica ligado para
    vários cantos até Esc ou "Terminar canto";
  - **Canto vivo**: clique no "+" de um lado — os lados vizinhos se estendem até se encontrar e o lado some
    (desfaz um chanfro);
  - **Offset** do contorno externo (positivo para fora, negativo para dentro).
  As alturas dos pontos acompanham os pontos novos.

## [2.43.0] — 2026-10-27 · Edição do piso na tela

### Adicionado
- Com um piso selecionado, a edição do Editar piso aparece **na própria vista**: contorno em destaque e a **medida de
  cada lado** (do lado de fora, alinhada com o lado); clique na medida para digitar o comprimento (a ponta final anda
  na direção do lado).
- **Furos** editáveis na tela: pontos, "+" no meio dos lados, medidas e botão direito para apagar (no último ponto
  possível, apaga o furo).

## [2.42.2] — 2026-10-27 · Talude na aresta de cima do piso

### Corrigido
- O terreno aparecia **serrilhado na face lateral** do piso (os triângulos que cruzavam a borda ficavam abaixo do
  topo): o perfil do talude agora continua um pouco para dentro do piso, então a superfície cruza a **aresta de
  cima** exatamente na cota do topo, no corte e no aterro. A sobra embaixo do piso fica acima do fundo dele (o piso
  corta tudo) — evita faces coincidentes que travavam o corte booleano.

## [2.42.1] — 2026-10-27 · Talude sai da aresta do piso

### Corrigido
- O talude ficava com um **desnível** na borda quando o piso tinha pontos com altura: agora ele sai da **aresta do
  piso**, na cota real do topo em cada ponto do contorno (com as alturas dos pontos e o piso inclinado).
- Malha do terreno mais fina (20 cm) junto da aresta dos pisos, sem degraus serrilhados, e subdividida só até onde
  o talude pode chegar (o fundo não é subdividido): o recálculo ficou várias vezes mais rápido.

## [2.42.0] — 2026-10-27 · Suavizar o talude

### Adicionado
- Opção **Suavizar · raio** no Talude do piso (`talude.suavizar`, `talude.raio`, padrão 1 m): as quinas do perfil
  (crista, pé e bordas das bermas) viram curvas da largura do raio e o encontro com o terreno natural concorda
  (mínimo/máximo suaves). Na borda do piso o talude continua começando na cota do topo.

## [2.41.0] — 2026-10-27 · Talude de corte e aterro

### Adicionado
- Opção **Talude** no piso (Propriedades › Talude; dado `slab.talude`), com duas configurações, **Corte** e
  **Aterro**, cada uma com liga/desliga, **proporção V : H** das instâncias, **altura da instância** e **distância
  entre instâncias** (berma). Padrões: corte 1 : 1, aterro 1 : 1,5, instâncias de 3 m e bermas de 2 m.
- slopes.js: a superfície dos terrenos em volta fica presa entre o perfil de aterro (embaixo) e o de corte (em
  cima), medidos do contorno do piso, na cota do topo dele; aplicado pelo sistema de cortes antes das booleanas.

## [2.40.0] — 2026-10-27 · Terreno cortado por terreno (corte e aterro)

### Adicionado
- Quando um terreno se sobrepõe a outro terreno **maior** (área do contorno), o menor corta o maior em **toda a
  profundidade** e **desce até o fundo** dele: onde a superfície do menor está abaixo da do maior é corte, onde
  está acima é aterro — a parte baixa fica preenchida. Funciona em cadeia (terreno dentro de terreno dentro de
  terreno) e recalcula sozinho ao mover ou editar os terrenos.

## [2.39.1] — 2026-10-27 · Unidade do projeto em todas as ferramentas

### Corrigido
- Ao trocar m / cm / mm, todas as ferramentas acompanham (os dados continuam em metros):
  - diálogos de criar Parede, Piso, Pilar, Viga e Caixa (rótulos e valores);
  - parâmetros de comprimento dos objetos no painel Propriedades e na prévia do editor de Objetos (e as medidas
    da peça); centro do vão de portas/janelas; afastamento da cota; escala do padrão dos materiais;
  - espessuras no editor de Tipos e camadas e na lista de camadas do elemento;
  - Deslocamento e Afastamento em Propriedades; mensagens do vão que não cabe e da posição na parede;
  - painéis abertos das ferramentas Piso, Copiar, Espelhar e Telhado são refeitos na unidade nova sem perder
    os valores digitados.

## [2.39.0] — 2026-10-27 · Piso como terreno

### Adicionado
- Opção **Terreno** no piso (Propriedades › Pontos do piso e diálogo Editar piso; dado `slab.terreno`):
  - só a **superfície** segue os pontos de altura; o fundo fica plano (abaixo do ponto mais baixo) e as camadas
    de dentro se esticam na proporção;
  - os **outros pisos cortam o terreno** (booleana three-bvh-csg, no mesmo sistema do Cortar com vazio): sai o
    volume do contorno de cada piso, do fundo dele para cima; recalcula sozinho ao mover ou editar os pisos.
  - Propriedade **Terreno** aparece no piso.

## [2.38.0] — 2026-10-27 · Laje vira Piso em tudo

### Mudado
- "Laje" passa a se chamar **Piso** em toda a interface: camada padrão **Pisos** (era "Pisos e lajes") e
  **Pisos estruturais** (era "Lajes estruturais"), categoria dos tipos, estilo Colorido, categorias de objetos,
  dica da faixa de Tipos e camadas, diálogo Piso das linhas, ferramentas da IA e do MCP (`ler_projeto` devolve
  `piso`), skills de fábrica e o script do objeto Piso (revisão 4).
- Tipos de fábrica: **Piso de concreto 12 + contrapiso + cerâmico**, **Piso de concreto 10**, **Genérico 15** e
  a camada **Concreto estrutural**; o telhado de concreto virou **Concreto inclinado impermeabilizado** (ids iguais).
- **Migração única no servidor** (chave `migracao:piso`): renomeia nos dados já gravados as camadas, os tipos
  (biblioteca e projetos) e os elementos "Laje N" para "Piso N".

## [2.37.0] — 2026-10-27 · Editar piso

### Adicionado
- **Editar piso** depois de feito, no estilo do Editar parede: clique duplo no piso, botão **Editar piso e linhas…**
  em Propriedades ou faixa › Piso › Editar piso e linhas. Diálogo com nome, tipo (ou genérico), cota do topo e um
  editor 2D em planta das **linhas do piso**: arrastar pontos (grade de 1 cm, Shift trava 0°/90°), clique duplo num
  lado acrescenta um ponto, botão direito ou Delete tira, clique num lado mostra a medida e muda o comprimento,
  X/Y do ponto selecionado, medidas de cada lado, área, **＋ Furo**, **Apagar furo** e **Retângulo**.
  As alturas dos pontos (Pontos do piso) acompanham os pontos acrescentados e tirados.

## [2.36.0] — 2026-10-27 · Piso com pontos editáveis

### Adicionado
- **Pontos do piso** (faixa › Piso › Editar pontos do piso, e Propriedades de um piso selecionado):
  - arrastar os pontos do contorno (snap nos pontos de outros pisos e nas pontas de paredes e linhas; ORTO/Shift);
  - **+** no meio de cada lado coloca um ponto novo; botão direito apaga (o contorno fica com pelo menos 3);
  - clique num ponto para digitar a **altura** (deslocamento do topo); **＋ Ponto interno** coloca pontos de forma;
  - a superfície passa pelos pontos (triangulação de Delaunay, interpolação linear) e todas as camadas acompanham;
  - tabela X / Y / altura em Propriedades e o botão **Piso plano** para zerar.
  - Dados novos no elemento: `slab.alturas` (uma por ponto do contorno) e `slab.forma` (`[[x, y, dz], …]`).

### Mudado
- O objeto **Laje** passou a se chamar **Piso** (biblioteca, faixa, ferramenta, nome dos elementos novos, MCP).
  O id continua `laje`, então projetos e presets antigos seguem funcionando; a revisão 3 do objeto de fábrica
  atualiza a biblioteca geral e as cópias dos projetos que ninguém editou.

## [2.35.1] — 2026-10-27 · Sem a ferramenta Terreno

### Removido
- **Ferramenta Terreno** (criada na 2.35.0, que não chegou a ser publicada): o comando da faixa, o elemento de
  terreno e o material "Terreno" de fábrica saíram. Nada mais muda.

## [2.34.1] — 2026-10-26 · Ícones no Personalizar menus

### Mudado
- **Personalizar menus** mostra o ícone de cada item: nos comandos (o mesmo da faixa), nos objetos (ícone ou
  miniatura do objeto; um genérico quando não há) e na lista "Na ordem da faixa" do grupo.

## [2.34.0] — 2026-10-26 · Medidor do Chat IA

### Adicionado
- **Medidor no Chat IA** (faixa logo abaixo do cabeçalho do chat):
  - **Modelo**: barra de carregamento animada enquanto a IA trabalha, com o tempo decorrido; com LM Studio ou Ollama
    mostra se o modelo está carregado na memória (e "carregando o modelo" na primeira chamada a um modelo
    descarregado); depois, o tempo da última resposta.
  - **Contexto**: quanto da janela de contexto do modelo a conversa ocupa — verde, âmbar a partir de 60%, vermelho a
    partir de 85%. O limite vem do LM Studio/Ollama, do agente (`contexto`) ou de uma tabela por modelo (Claude,
    GPT, Gemini, DeepSeek, Mistral, Grok, Llama, Qwen…).
  - **Tokens**: os da última chamada (↑ entrada, ↓ saída) e o total da conversa, com o número de chamadas. "Nova"
    zera.

## [2.33.0] — 2026-10-26 · Cotas como objeto

### Adicionado
- **Cotas** (Desenho › Cota): clique o 1º ponto, o 2º (encaixe em pontas e faces de paredes/vigas e quinas das
  peças; Shift solta o encaixe) e a posição da linha. Cada cota é um **objeto do projeto** (grava, sincroniza com a
  equipe, desfaz/refaz, apaga, camadas, Mover) e aparece nas plantas e forros do nível dela e no 3D.
- **Todos os parâmetros configuráveis**, no painel Propriedades: orientação (alinhada, horizontal, vertical),
  afastamento, texto substituto e — por estilo ou só nesta cota (↺ volta ao estilo) — altura do texto (mm de papel),
  cor, posição (acima, sobre, abaixo), fundo, unidade (projeto, m, cm, mm), casas decimais, mostrar unidade, prefixo,
  sufixo, marca (traço 45°, seta, ponto, nenhuma) e tamanho, cor e peso da linha, afastamento e prolongamento das
  linhas de chamada.
- **Estilos de cota** do projeto (como os tipos de cota do Revit): criar, duplicar, renomear, apagar e editar; "Salvar
  como novo estilo" a partir de uma cota.
- Tamanhos em mm de papel, convertidos pela escala da vista; arrastar o texto de uma cota selecionada muda o
  afastamento.

## [2.32.0] — 2026-10-26 · Renomear e duplicar vistas

### Adicionado
- **Renomear vistas** no navegador de projeto (clique duplo, ✎ ou botão direito): vale para qualquer vista, inclusive
  as de fábrica; nome vazio volta ao original.
- **Duplicar vistas** (⧉ ou botão direito): a cópia mostra o mesmo que a original, com câmera, estilo e escala
  próprios (começa com os da original) e aparece logo abaixo dela; ✕ apaga a cópia. Nomes e cópias ficam gravados
  no projeto (`dados.vistas`).

### Corrigido
- Servidor: duas alterações de configuração do projeto enviadas quase juntas (ex.: escala e nome de vista) podiam
  se sobrepor, e a primeira se perdia. Agora a gravação é feita uma por vez, por projeto.

## [2.31.0] — 2026-10-26 · Hachura nos materiais

### Adicionado
- **Hachura dos materiais**, vista só nas vistas de desenho (preenchimento do corte das plantas e forros): padrão
  (sólido, diagonal, cruzada, concreto, alvenaria, areia/reboco, isolamento, madeira, metal, vidro, terra ou
  nenhuma), espaçamento em mm de papel, ângulo, cor da linha e cor de fundo — em Editor de materiais › Hachura,
  com prévia. Os materiais de fábrica já vêm com o padrão certo (concreto, alvenaria no bloco cerâmico, areia no
  reboco, isolamento na lã mineral…). Desenhada em coordenadas do modelo: acompanha a peça e respeita a escala.

### Corrigido
- Editor de materiais mostrava "undefined" ao lado da opacidade de materiais sem opacidade gravada.

## [2.30.0] — 2026-10-26 · Escala das vistas e peso das linhas

### Adicionado
- **Escala por vista** (1:1 … 1:1000; padrão 1:100) no seletor da barra de baixo, nas plantas, forros e elevações;
  gravada no projeto.
- **Peso das linhas** nas vistas de desenho, em mm de papel: **corte** (contorno onde o plano de corte atravessa as
  peças, calculado na hora — padrão 0,50 mm) e **projeção** (arestas vistas e divisas entre camadas de uma parede —
  0,25 mm). Na tela, a espessura segue a escala e o zoom (aproximar engrossa), como no Revit. "Pesos de linha…" no
  seletor de escala muda os valores do projeto. Botão **LF** (linhas finas) põe tudo com 1 px.

### Mudado
- As arestas das peças passam a ser linhas com espessura real (antes, sempre 1 px).

## [2.29.0] — 2026-10-26 · Gizmo da origem 0,0

### Adicionado
- **Gizmo da origem (0,0)** em todas as vistas: setas X (vermelha), Y (verde) e Z (azul, no 3D e nas elevações)
  saindo do ponto 0,0 do projeto, com o rótulo "0,0", sempre do mesmo tamanho na tela; nas plantas fica na cota do
  nível. Quando a origem está fora da tela, uma seta na borda aponta para ela — clicar leva a vista até a origem.
  Chip **Origem 0,0** na vista liga/desliga (fica neste navegador).

## [2.28.0] — 2026-10-26 · Ícones da Tabler

### Mudado
- **Ícones genéricos da [Tabler Icons](https://tabler.io/icons)** (licença MIT), embutidos no BoxBim — sem
  dependência nova: abrir, captura, inserir objeto, ambientes, seleção, aparar, mover, girar, desfazer/refazer,
  copiar, espelhar, vistas, vista 3D, enquadrar, aparência, render, estilo Textura, materiais, Revit (trazer/enviar,
  conexão), biblioteca, novo objeto, orçamento, IA, chat, agentes, memória, configurações e o 👁 da barra de baixo.
  Recebem as cores da marca: forma principal em azul-petróleo translúcido, detalhe da ação em verde.
- Os ícones de CAD que a Tabler não tem continuam próprios, no mesmo traço: parede/laje/telhado, níveis, eixos de
  trabalho, estender, canto, offset 2D/3D, linhas do sólido, extrudar, varrer, vazios, junções, parede até o telhado,
  plantas, forro, elevação e os formatos de arquivo (IFC, DWG, DXF, FBX, DAE, GLB, RVT, BBO).
- Licença registrada em `THIRD-PARTY-NOTICES.md`; `scripts/gen-tabler-icons.py` refaz o arquivo a partir do pacote.

## [2.27.0] — 2026-10-26 · Acabamento visual (skill high-end-visual-design)

### Mudado
- **Páginas de entrada, login, projetos e biblioteca** no estilo "Ethereal Glass" nas cores do BoxBim: fundo preto
  profundo com brilhos suaves verde e azul-petróleo, barra superior em "ilha" de vidro flutuante, etiqueta acima
  do título e título grande, cartões em **moldura dupla** (casca + núcleo, raios concêntricos), botões principais
  em pílula com o ícone num círculo ("Novo projeto +", "Entrar ↗"), linhas finíssimas no lugar das bordas cinza e
  sombras amplas e suaves. Os cartões entram com um fade suave e escalonado ao aparecer na tela.
- **Editor**: janelas com moldura dupla, fundo desfocado e entrada de mola; menus suspensos, barras e avisos de
  vidro; botões principais em pílula; ícones da faixa com traço mais leve; transições com curva de mola
  (`cubic-bezier(.32,.72,0,1)`), só em transform/opacidade/cores. A densidade de ferramentas não mudou.
- Respeita "reduzir movimento" do sistema (sem animações de entrada).

### Corrigido
- Cabeçalho da tabela de Elevações saía embolado numa célula só.

## [2.26.0] — 2026-10-26 · Desfazer e refazer

### Adicionado
- **Desfazer e refazer de todo o projeto**: botões **↶ ↷** no topo, logo depois do nome do BoxBim, e **Ctrl+Z** /
  **Ctrl+Y** (ou Ctrl+Shift+Z). Vale para qualquer alteração sua — criar, apagar, mover, mudar tipo, portas e
  janelas… —, até 100 passos por sessão; o título do botão diz o que será desfeito. O resultado é gravado e a equipe
  vê na hora. Alterações de outras pessoas não entram no seu histórico.

### Corrigido
- Uma parede trocada pela versão nova (alteração de outra pessoa, desfazer) apagava as portas e janelas que ela
  hospedava.

## [2.25.1] — 2026-10-26 · Conserto de portas e janelas em projetos antigos

### Corrigido
- Projetos salvos antes da 2.25.0 podiam ter portas/janelas **soltas da parede** (a parede foi movida e elas
  ficaram para trás) e **vãos sem porta** (a porta foi apagada mas o furo ficou). Ao abrir o projeto, o BoxBim agora
  conserta sozinho: a porta/janela solta volta para o vão de mesma medida e mesmo deslocamento na parede (e passa a
  acompanhá-la), e o vão que ninguém ocupa fecha. As correções são gravadas no projeto.

## [2.25.0] — 2026-10-26 · Paredes levam portas e janelas; marcadores de elevação arrastáveis

### Corrigido
- **Mover uma parede deixava as portas e janelas para trás** depois de reabrir o projeto: o vínculo parede ↔
  porta/janela usava o identificador da sessão (que muda a cada abertura). Agora usa o GUID do elemento (gravado
  no banco); ao abrir o projeto, os vínculos antigos são refeitos pela posição (a porta sobre o vão da parede) e
  gravados.
- Portas e janelas **acompanham a parede por qualquer caminho**: Mover/Girar, cota automática, pontas (grips),
  aparar/estender, espelhar ou alteração de outra pessoa — ficam no mesmo deslocamento ao longo da parede.

### Adicionado
- **Arrastar os marcadores de elevação nas plantas** (botão esquerdo): muda a linha da elevação (encaixe de 5 cm),
  com as linhas de profundidade e largura indo junto; grava no projeto ao soltar. Clique duplo continua abrindo a
  elevação; o cursor vira ✥ sobre o marcador.

## [2.24.0] — 2026-10-26 · Mouse, revelar ocultos, cotas automáticas e elevações próprias

### Adicionado
- **Botão direito seleciona**: clique seleciona; arrastando abre a janela de seleção (→ só o que está inteiro
  dentro, azul; ← o que tocar, verde tracejado). **Alt + botão direito gira** a vista (nas plantas, arrasta).
  O pivô do Mover/Girar pelo botão direito vale com a ferramenta ativa.
- **Chips na vista** (canto direito) para ligar/desligar **Níveis**, **Eixos de trabalho** e os marcadores de
  **Elevação** na tela (só para quem está vendo).
- **👁 Revelar ocultos** na barra de baixo, com o número de ocultos: os ocultos aparecem com contorno magenta e a
  vista ganha borda magenta; clicar num deles o mostra de volta; "Mostrar todos". **H** oculta a seleção e
  **Shift+H** mostra tudo; o olho da árvore de elementos usa o mesmo sistema.
- **Cotas automáticas da seleção**: com uma peça selecionada, a distância até a peça paralela mais próxima de cada
  lado — paredes, vigas e linhas face a face, no trecho comum; outras peças em ±X e ±Y, no mesmo andar. Clicar no
  número digita outra distância e a peça anda até ela (Ctrl+Z desfaz).
- **Elevações próprias** (Vistas › Gerenciar elevações, ⚙ no navegador, chip "Elevações…"): nome livre, direção
  (N/S/L/O ou ângulo), linha (X, Y), **profundidade** e **largura** (o que fica fora é recortado) e **visível ou
  não** (navegador, menus e marcador nas plantas). Marcadores nas plantas com a seta para onde se olha; clique
  duplo abre a elevação. Gravadas no projeto (`dados.elevacoes`); as quatro de fábrica também são editáveis.
- Navegação mais clara: o nome do elemento sob o cursor aparece na barra de status (cursor de mão), e o botão
  **?** na vista mostra a ajuda do mouse e dos atalhos (sozinha na primeira vez).

### Mudado
- Botão do meio passa a arrastar a vista (antes o direito arrastava).
- Linhas de nível: o chip/opção vale para a Vista 3D e para as elevações.

## [2.23.0] — 2026-10-26 · Ferramentas agrupadas e ícones novos

### Mudado
- **Ferramentas parecidas num botão só** (botão de família): o clique repete a última usada — o botão mostra o
  ícone e o nome dela — e a seta **▾** abre a lista com as outras, cada uma com ícone e atalho. A faixa padrão
  caiu de ~60 para ~25 botões:
  Abrir (abrir/importar IFC, DWG, DXF, FBX, Collada, .rvt) · Exportar (IFC, DWG, FBX, Collada, glTF, .rvt, imagem) ·
  Laje e piso · Níveis (novo, editar) · Eixo de trabalho (novo, plano do nível) · Editar linhas (aparar, estender,
  canto) · Offset (2D, 3D) · Sólido (extrudar, varrer) · Vazio (cortar, tirar corte) · Mover e girar (e desfazer) ·
  Copiar e espelhar · Ajustar paredes (junções, até o telhado) · Vistas (3D, plantas, forros, elevações) ·
  Aparência (Render, estilo Textura, materiais, texturas) · Biblioteca (novo objeto, importar .bbo) · Revit · IA.
- Os presets de menus gravados são convertidos uma vez: os comandos de uma mesma família viram o botão da família
  e grupos que ficam vazios saem. Os comandos soltos continuam disponíveis em Personalizar menus.
- **Ícones redesenhados** nas cores do ícone do BoxBim: formas em azul petróleo (#26536E), traço claro e
  destaques no verde da marca (#169E2E); arquivos ganham o documento com a sigla (IFC, DWG, DXF, FBX, DAE, GLB,
  RVT, BBO). Os menus suspensos mostram os ícones.

### Adicionado
- Comando **Estilo Textura** (na família Aparência).

## [2.22.0] — 2026-10-26 · Entrada com projeto de demonstração

### Adicionado
- **Demonstração na entrada** (`/demo.html`): quem abre o BoxBim sem estar logado vê a **Casa Horizonte** — casa
  moderna de dois pavimentos com pano de vidro, parede de pedra, pavimento em balanço revestido de madeira,
  piscina de pastilha com água animada, deck e jardim — montada no navegador com os materiais procedurais do
  BoxBim (inclusive texturas próprias em camadas), céu físico, sol com sombras e oclusão ambiente. A câmera passeia
  sozinha (arrastar/rolar assume; ela volta a girar depois de alguns segundos) e o sol desce até o entardecer,
  acendendo as luzes de dentro.
- O botão **Entrar** abre o login por cima a qualquer momento (com ✕ para voltar); depois de **5 minutos** o login
  cobre a tela de vez. `BOXBIM_DEMO_MIN` muda o tempo; `BOXBIM_DEMO=0` desliga (o visitante vai direto ao login).

### Mudado
- `/` leva quem tem sessão aos projetos e o visitante à demonstração (antes, sempre aos projetos → login).

## [2.21.0] — 2026-10-26 · Texturas procedurais próprias (manual e pelo Chat IA)

### Adicionado
- **Editor de texturas** (Vistas › Texturas, ou ★… ao lado do Padrão no Editor de materiais): crie texturas
  procedurais próprias como pilhas de camadas. Cada camada tem um gerador — ruído, escovado, células (pedras),
  ladrilhos/tijolos, listras/tábuas, pontos/furos, veios de madeira, ondas ou constante —, os seus parâmetros, um
  remapeamento (de → até, inverter) e escreve nos canais tom, altura, rugosidade, metal, opacidade e detalhe
  (multiplicar, misturar, somar, mínimo, máximo; força). Daí saem todos os mapas: cor, bump, normal, AO,
  deslocamento, rugosidade/brilho, metal, especular, opacidade e emissão.
- Modelos para começar (tijolo aparente, pedra rústica, deck de madeira, chapa perfurada), amostra colorida com
  relevo e os mapas atualizados ao vivo; "Usar no material" aplica ao salvar.
- As texturas ficam gravadas na biblioteca de tipos do projeto (a equipe recebe em tempo real) e aparecem com ★
  no Padrão de qualquer material. São só dados (sem código), seguras num projeto compartilhado.
- **Chat IA**: ferramentas `list_materials`, `create_texture` (a IA monta as camadas a partir de uma descrição e
  aplica a um material) e `set_material` (cor, padrão, escala e todos os mapas de um material).

## [2.20.0] — 2026-10-26 · Estilo de vista Textura

### Adicionado
- **Textura**, novo estilo de vista (barra de estilos, entre Transparente e Render): os materiais com cor, relevo e
  todos os mapas procedurais, na luz normal da vista e com linhas e grade — sem céu, sol, sombras nem
  pós-processamento. Serve para modelar e conferir os materiais antes do Render; o painel Materiais das
  Propriedades e o Editor de materiais atualizam a vista ao vivo.

## [2.19.1] — 2026-10-26 · Comandos novos aparecem na faixa

### Corrigido
- **Ambientes** (e **Materiais**) não apareciam na faixa: os presets de menus guardam uma cópia dos botões, e
  comandos novos do BoxBim nunca entravam neles. Agora cada preset lembra os comandos que já viu e os novos
  entram sozinhos no grupo de mesmo nome (Modelar › Ambientes, Vistas › Materiais). Um comando que você tirou
  do preset não volta.

## [2.19.0] — 2026-10-26 · Sistema de materiais com mapas procedurais

### Adicionado
- **Editor de materiais** (Vistas › Materiais, ou **Mapas…** em Propriedades › Materiais (render)): biblioteca de
  materiais com pré-visualização 3D (esfera e cubo, gire com o mouse) e os quadros de cada mapa gerado.
- **Mapas procedurais** (sem arquivos de imagem) de cada padrão: **relevo (bump)**, **normal**, **oclusão
  ambiente (AO)**, **deslocamento** (paralaxe: as juntas afundam sem malha densa), **rugosidade** e **brilho**
  (glossiness, ligado à rugosidade), **metal**, **especular** (intensidade, cor e mapa), **opacidade** (recorte de
  furos e vãos) e **emissão** (cor, intensidade e mapa). Cada mapa liga/desliga e tem a sua intensidade.
- Padrões novos: **pastilha**, **ripado (vazado)** e **chapa perfurada**, além de concreto, reboco, tijolo,
  cerâmica, madeira, metal escovado, pedra e grama.
- O bump passa a valer junto com o mapa normal (o normal dá o relevo das peças, o bump o detalhe fino).

### Mudado
- As texturas do Render usam UVs em metros projetadas em caixa (no lugar da projeção triplanar só da cor):
  todos os mapas ficam na escala real e o path tracing enxerga os mesmos mapas. As UVs originais voltam ao sair.

## [2.18.0] — 2026-10-26 · Ambientes e camadas com permissões

### Adicionado
- **Ambientes e camadas** (Modelar › Ambientes, ou ⚙ no navegador): o dono do projeto cria ambientes com o nome
  que quiser (ex.: Arquitetura, Estrutura, Instalações) e, dentro de cada um, camadas com os desenhos que recebem
  (ex.: Arquitetura › Paredes recebe paredes; Pisos e lajes recebe lajes). "Usar o modelo" preenche um ponto de
  partida. Ao salvar, os elementos sem camada são distribuídos pelo tipo.
- Cada elemento novo cai na camada ativa (ou na primeira que aceita o seu tipo); o painel de propriedades mostra
  e troca a camada. No navegador, cada camada pode ser **ocultada** (👁) ou **travada** (🔒).
- **Permissão por camada**: no Compartilhar, o botão "Camadas" de cada participante libera uma ou mais camadas
  (ou todas). Quem tem camadas limitadas vê o projeto inteiro, mas só seleciona e edita o que está nas camadas
  liberadas (⛔ nas outras). O servidor também confere: alterações fora das camadas liberadas são recusadas, no
  tempo real e no MCP (as ferramentas do MCP ganharam o parâmetro `camada`).

### Corrigido
- Participante que não é administrador não conseguia abrir o app (a tela de memórias pedia uma informação só do
  administrador).
- Elemento antigo sem propriedades travava a reconstrução da geometria.

## [2.17.0] — 2026-10-26 · Sem a conexão com o Unreal Engine

### Removido
- **Conexão com o Unreal Engine** (DLSS): o botão "Abrir no Unreal" do Render, o comando "Unreal (DLSS)" da faixa
  (presets que o tinham simplesmente o ignoram), a ponte no servidor (`unreal:*`, projeto e script Python do
  Unreal) e o caminho do Unreal em Configurações › Ferramentas. O estilo Render e o path tracing continuam.

### Corrigido
- **Servidor na nuvem**: o app não fica mais perguntando pelo Revit a cada 15 s (o servidor recusava com 403 e o
  console enchia de erros); o indicador mostra "Revit (só local)".
- Política de segurança (CSP): tirado um endereço inválido (`http://[::1]:*`) que o navegador acusava no console.

## [2.16.1] — 2026-10-26 · Créditos, AGENT.MD e regras do projeto

### Adicionado
- Créditos **"BoxHoney By Marcelo Olimpio – Eng. de software"** (link para marceloolimpio.com.br) no rodapé da lateral
  direita do aplicativo, com a versão atual, e no fim da documentação (README, DEPLOY, CHANGELOG, AGENT.MD).
- **AGENT.MD**: mapa da arquitetura (diagrama Mermaid de como os módulos e funções se ligam: navegador, servidor,
  banco, tempo real, IA e MCP), fluxos principais e a lista de cada commit.
- Regras do projeto no `CLAUDE.md`: commit no modelo `data – especificações - vX.Y.Z`, AGENT.MD e créditos sempre
  atualizados.

## [2.16.0] — 2026-10-26 · IA local com o BoxBim na nuvem e MCP (servidor e cliente)

### Corrigido
- **LM Studio / Ollama / llama.cpp não funcionavam com o BoxBim numa VPS**: `http://127.0.0.1:1234` no servidor é a
  própria VPS, não o seu computador. Agora, com o servidor remoto (`BOXBIM_REMOTO=1`) e o endereço local ou da rede
  interna, **o navegador chama a IA direto** (ele está no seu computador). No LM Studio, ligue Developer › Server
  Settings › "Enable CORS"; no Ollama, `OLLAMA_ORIGINS=*`; se o navegador pedir acesso à rede local, permita.
  `BOXBIM_CONNECT_SRC` libera outros endereços (ex.: um servidor na rede do escritório).

### Adicionado
- **BoxBim como servidor MCP** (`POST /mcp`, Streamable HTTP): Claude Desktop, Claude Code e outros clientes MCP
  listam e leem os projetos e modelam neles — criar níveis, paredes (com tipo), lajes (com furos), linhas 2D, mover e
  apagar elementos — com as permissões do usuário; o resultado aparece **ao vivo** para quem está com o projeto
  aberto. Acesso por **token** de cada usuário (⚙ Configurações › MCP › Gerar token), com os comandos prontos para
  Claude Code e Claude Desktop; tokens guardados só como hash, revogáveis.
- **Chat IA usando servidores MCP**: em ⚙ Configurações › MCP, cadastre servidores (URL + token opcional); as
  ferramentas deles entram nos agentes do Chat IA. Servidores na internet são chamados pelo servidor do BoxBim
  (tokens cifrados); os "no meu computador" (localhost), pelo navegador. Respostas em JSON ou SSE, com sessão.

## [2.15.0] — 2026-10-23 · Espelhar, parede até o telhado e editor de parede

### Adicionado
- **Espelhar** (Modificar): espelha a seleção por uma **linha** — dois cliques (2D no plano do nível ou 3D sobre os
  sólidos) ou "Pegar linha" (uma linha 2D ou o eixo de uma parede). Plano do espelho: **vertical** (planta),
  **horizontal** (de cabeça para baixo) ou **perpendicular ao eixo de trabalho ativo** (fachada). "Manter o original"
  espelha cópias. Paredes trocam início/fim (a face externa fica do lado espelhado) e levam portas/janelas; linhas,
  vigas e o resto (objetos, lajes, telhados, sólidos) também espelham.
- **Parede até o telhado** (Modificar, e no painel da parede): o topo das paredes selecionadas passa a seguir a
  **face de baixo do telhado** acima delas — estende as baixas e recorta as altas; nas empenas, vira oitão. Pelas duas
  faces da parede, para o telhado não entrar nela; trechos sem telhado mantêm a altura.
- **Editar parede** (clique duplo na parede, ou "Editar parede e perfil…" no painel): nome, tipo, comprimento, base,
  altura e o **perfil de elevação** num editor 2D — arrastar vértices (Shift alinha), clique duplo numa aresta
  acrescenta, botão direito/Delete tira; prontos: Retângulo, Oitão, Inclinado e "⌂ Até o telhado"; portas e janelas
  aparecem no desenho.
- **Perfil próprio de parede** (`wall.perfil`): contorno de elevação qualquer, com os vãos (portas recortam o pé,
  janelas viram furos), cantos em meia-esquadria e junções em T; vale também no objeto Parede (`p.perfis`).

## [2.14.1] — 2026-10-23 · Pronto para VPS (Docker / Easypanel)

### Adicionado
- **Dockerfile** (Node 24, build do renderer na imagem, usuário sem privilégios, volume `/data`, verificação de
  saúde), `.dockerignore`, `.env.example` e o guia **DEPLOY.md** para publicar no Easypanel (GitHub → App →
  Dockerfile, volume `/data`, domínio com HTTPS na porta 3000).
- `GET /api/saude` (sem login) para a verificação de saúde.
- `BOXBIM_PROXY=1`: atrás de proxy reverso, o IP real do cliente vem do `X-Forwarded-For` (limite de tentativas).
- `BOXBIM_REMOTO=1`: servidor na nuvem — Revit, Unreal, Blender e arquivos do computador desligados (um proxy na
  mesma máquina não passa mais por "local").
- `BOXBIM_CODIGO_CADASTRO`: criar conta exige o código (a 1ª conta, do administrador, não); o campo aparece na
  tela de cadastro só quando o servidor pede.
- Repositório git, `.gitignore`/`.gitattributes` e `CLAUDE.md` com a regra de um commit por atualização.

## [2.14.0] — 2026-10-23 · Copiar (2D e 3D) e Telhado por perfil com camadas

### Adicionado
- **Copiar** (Modificar): copia qualquer coisa — linhas 2D, paredes, lajes, telhados, objetos, sólidos, eixos.
  Selecione (antes ou com a ferramenta), clique o ponto base e os destinos (cada clique é uma cópia; "Várias
  cópias" pode ser desligado). **2D**: pontos no plano do nível, snap nas pontas de linhas e paredes, ORTO;
  **3D**: pontos sobre os sólidos, snap nos vértices, o deslocamento leva o Z. Número + Enter = distância na
  direção do cursor; **Repetições** faz cópias em série; **Copiar para nível…** e **Por distância…** (ΔX/ΔY/ΔZ).
  As cópias têm GUID novo e sincronizam; portas e janelas vão junto com a parede, hospedadas na cópia.
- **Telhado** (Modelar, e Inserir objeto › Telhado): escolha (ou crie com 2 cliques) um **eixo de trabalho
  vertical**, desenhe nele o **perfil** do telhado — a linha de cima (duas águas, uma água, quebrada…) com snap nas
  cotas dos níveis, ORTO e comprimento digitado; a dica mostra a inclinação em % e graus — ou use linhas 2D já
  desenhadas no eixo. A extrusão (início/fim na normal do eixo) é automática pelo que está debaixo do perfil, mais o
  **beiral**, ou digitada. Opções no painel da direita.
- **Tipos de telhado com camadas** (Tipos e camadas › Telhados): Telha cerâmica + madeiramento (telha, ripas,
  caibros), Telha metálica sanduíche 50, Fibrocimento 6 mm, Laje inclinada impermeabilizada, Genérico 15; materiais
  Telha cerâmica e Fibrocimento. As camadas descem a partir da linha do perfil.
- **Objeto de sistema Telhado** (`telhado.bbo`, IfcRoof): recebe as seções das camadas prontas e extruda; parâmetro
  Comprimento. Propriedades: área, inclinações, espessura, camadas.

## [2.13.1] — 2026-10-23 · Chat IA com Gemini 3: assinatura de raciocínio

### Corrigido
- **"HTTP 400: Function call is missing a thought_signature"** ao usar ferramentas (ex.: `add_level`) com modelos
  Gemini que raciocinam (Gemini 3), principalmente pelo **OpenRouter** ou pelo endpoint OpenAI-compatível do Google.
  A assinatura que o modelo manda junto de cada chamada de ferramenta agora é guardada e devolvida no histórico em
  todos os caminhos: Gemini nativo (`thoughtSignature`), OpenAI-compatível do Google
  (`extra_content.google.thought_signature`) e OpenRouter (`reasoning_details`). Chamadas feitas por outro
  modelo/agente na mesma conversa vão com o valor que o Google indica para pular a validação.

## [2.13.0] — 2026-10-23 · Laje por croqui, linhas 2D, paredes ou sólido (com furos)

### Adicionado
- **Ferramenta Laje** (Modelar › Laje, e Inserir objeto › Laje): monta o contorno, como o esboço de piso do Revit,
  juntando qualquer combinação de fontes — opções no painel da direita:
  - **✎ Croqui**: polilinha (C fecha) ou retângulo desenhados na hora, com snap em pontas e ORTO;
  - **⟋ Linhas 2D**: clicar numa linha do desenho traz ela e as ligadas pelas pontas;
  - **▭ Paredes**: clicar numa parede traz o contorno das paredes ligadas na **face externa**, **face interna** ou
    **eixo** (parede solta: a face do lado do clique);
  - **◧ Sólido**: clicar na face horizontal de um sólido traz o contorno dela (opção: topo da laje na cota da face).
  O contorno montado aparece em magenta; Desfazer/Limpar; **✔ Concluir** cria uma laje por contorno fechado, com
  nível, tipo e deslocamento do topo escolhidos.
- **Lajes com furos**: contornos fechados dentro de outro viram furos (shafts, escadas, aberturas); a área desconta
  os furos. O objeto Laje de fábrica passou para a revisão 2 (lê `p.furos`); lajes com furos em projetos que ainda
  usam a cópia antiga do objeto ficam com a geometria nativa, que fura.

## [2.12.0] — 2026-10-23 · Junções em T, piso pelas linhas, eixos que acompanham os níveis e corte por nível

### Adicionado
- **Junções em T**: a ponta de uma parede (ou viga) que cai no meio de outra — no eixo ou entre as faces — para na
  **face** da outra, do seu lado, cortada no ângulo dela (vale para paredes oblíquas). Acontece ao desenhar paredes,
  ao criar por linha de referência e depois de Aparar, Estender, Canto e Offset. Botão **Ajustar junções**
  (Modificar) refaz cantos em meia-esquadria e T no projeto todo.
- **Piso das linhas** (Desenho): piso/laje a partir das linhas 2D selecionadas — cada contorno fechado horizontal
  vira um piso com o topo na cota das linhas (tipo de laje e deslocamento no diálogo). Em **Linhas do sólido**, o
  modo **"Piso do contorno da face"** cria o piso direto ao clicar na face horizontal de um sólido.
- **Configuração do corte por nível**: plano de corte e profundidade da vista ficam no nível (no projeto, para
  todos) — no diálogo do nível, nas colunas Corte/Profund. da tabela NÍVEIS e na "Faixa da vista" do painel da
  planta (que agora grava no nível). Valem para as plantas de piso e de forro do nível.

### Alterado
- **Eixos de trabalho com tamanho automático**: o retângulo acompanha os níveis (do mais baixo ao topo do mais alto)
  e a largura do modelo, e muda sozinho quando eles mudam. Dá para desligar no painel do eixo.

## [2.11.0] — 2026-10-23 · Aparar, Estender, Canto e Offset em paredes, vigas e canos

### Adicionado
- **Aparar, Estender, Canto e Offset valem para tudo que é linear**: paredes, vigas e varreduras (canos, perfis,
  corrimãos), além das linhas 2D — no plano do nível (planta ou Vista 3D). O eixo do elemento entra como uma linha:
  - **Aparar** encurta (ou divide em dois) pelo cruzamento com linhas, paredes, vigas ou canos; os vãos de portas e
    janelas acompanham o início da parede.
  - **Estender** leva a ponta até a próxima linha/eixo à frente.
  - **Canto vivo** junta as duas pontas no cruzamento já em **meia-esquadria**; **canto com raio** cria a curva —
    paredes e vigas em trechos de até 10° (com esquadria entre eles), canos como uma varredura curva com o mesmo
    perfil; **chanfro** cria o trecho inclinado do mesmo tipo do primeiro escolhido.
  - **Offset** cria a cópia paralela (paredes e vigas com o mesmo tipo, a cadeia ligada pelas pontas junto e cantos
    em esquadria; canos com o mesmo perfil).
- Meia-esquadria automática em vigas e em paredes/vigas que passam a se encontrar pelas pontas depois dessas
  ferramentas (e é desfeita quando deixam de se encontrar).

## [2.10.0] — 2026-10-23 · Cantos de parede em meia-esquadria, linhas do sólido e offset 2D/3D

### Adicionado
- **Linhas do sólido** (Desenho): clique numa aresta de um sólido e ela vira uma linha 2D; no modo "Contorno da
  face", todas as arestas da face clicada. As linhas ficam no plano da face (face horizontal = plano de nível na
  cota dela; outra face = um plano como o de um eixo de trabalho) ou, com "Projetar no plano do desenho", no nível
  ou eixo de trabalho ativo.
- **Offset 2D** (Desenho, tecla O; também no editor de objetos): cópia paralela de linha, arco ou círculo na
  distância da barra, do lado em que o cursor está. Linhas ligadas pelas pontas vão juntas ("Cadeia inteira"),
  com os cantos em esquadria; num contorno fechado, cursor dentro = para dentro, fora = para fora. O estilo da
  linha é mantido.
- **Offset 3D** (Desenho): cópia crescida (distância positiva) ou encolhida (negativa) dos sólidos selecionados —
  extrusão (perfil, furos e, em "todas as direções", base e topo), varredura (perfil), caixa (medidas) e qualquer
  outra malha (inflada pelas normais). Opções: manter o original e criar a cópia como vazio (para fazer casca).

### Alterado
- **Cantos das paredes bem acabados**: ao criar paredes encadeadas (desenhando ou por linha de referência), as
  pontas são cortadas em **meia-esquadria** na bissetriz do canto — cada parede vai só até o plano do canto, sem
  sobrepor a vizinha (sem faces brigando nem camadas cruzadas no corte das plantas). Curvas muito fechadas
  (> 150°) continuam com prolongamento.

## [2.9.0] — 2026-10-23 · Parede por linha de referência; opções no painel da direita

### Adicionado
- **Parede por linha de referência**: no modo "⟋ Por linha de referência", clicar numa linha do desenho 2D (Linha,
  Retângulo) cria as paredes ao longo dela — e das linhas ligadas a ela pelas pontas ("cadeia inteira", opcional).
  A prévia mostra as paredes ao passar o mouse sobre a linha.
- **Linha de localização**: Centro, Parte interna ou Parte externa da linha de referência — vale para o modo por
  linha e também para o desenho com cliques. Num contorno fechado, interna é para dentro (qualquer sentido do
  desenho); numa linha aberta, interna é à esquerda do sentido e "Inverter lado" troca. Os cantos ficam em
  esquadria (as paredes deslocadas se encontram certinho).

### Alterado
- **As opções da ferramenta de parede ficam no painel da direita** (aba Propriedades, que abre sozinha): modo,
  linha de localização, nível, altura, tipo e espessura, ORTO, Terminar e Sair. Saiu a barra flutuante da vista.

## [2.8.0] — 2026-10-23 · Varrer com perfil desenhado

### Alterado
- **Varrer usa sempre um perfil 2D desenhado num contorno fechado** (no projeto e no editor de objetos). Selecione
  juntos o caminho (linhas encadeadas, abertas ou fechadas) e o contorno fechado do perfil — que pode estar em
  outro plano. Desenhado num plano perpendicular ao início do caminho (ex.: um eixo de trabalho vertical
  cruzando o caminho), o perfil fica exatamente onde foi desenhado em relação ao caminho; desenhado em outro
  plano, é centrado no caminho. Saíram os perfis prontos (retângulo/círculo) e a altura do caminho; sem contorno
  fechado, o Varrer explica o que falta. No editor de objetos, selecione o caminho, troque o plano e selecione o
  perfil com Shift.

## [2.7.1] — 2026-10-23 · Correção do Retângulo

### Corrigido
- **Retângulo não desenhava com o ORTO ligado** (no projeto e no editor de objetos): o ORTO travava o segundo canto
  na horizontal/vertical do primeiro, uma das medidas ficava zero e nada era criado. O retângulo agora ignora o
  ORTO (os lados dele já são 0°/90°); Linha e Eixo continuam travando.

## [2.7.0] — 2026-10-23 · Desenho 2D e eixos de trabalho no editor de objetos

### Adicionado
- **Barra "2D" na prévia do editor de objetos**, com as mesmas ferramentas do projeto: Linha, Retângulo, Círculo,
  Seleção 2D (Shift soma, Delete apaga), Aparar, Estender, Canto (vivo, raio, chanfro), Extrudar, Varrer, ORTO,
  estilo das linhas novas e **Eixo de trabalho** (vertical de frente/lado, horizontal, por dois pontos ou livre).
  O plano do desenho é XY, XZ, YZ ou um eixo de trabalho; ao trocar, a câmera fica de frente para ele. Snap em
  pontas, meios, centros e na origem; comprimento e raio digitados na unidade do projeto.
- O código continua sendo a fonte do objeto: cada ferramenta escreve no script (Linha → `g.line`, Círculo →
  `g.circle`, Extrudar → `g.extrude`, Varrer → `g.sweep`, Eixo → `g.workplane` no começo) e Aparar/Estender/Canto
  reescrevem as chamadas tocadas (as simples, uma por linha do código).
- **API de objetos**: `g.workplane(nome, { x, y, z, rotX, rotY, rotZ })`, `g.line(pontos, { plane, closed, tipo,
  espessura, color })`, `g.arc`, `g.circle`, `g.sweep(caminho, perfil)`, `g.extrude(…, { plane: 'Eixo A' })` (sobe
  na normal do eixo) e `{ vazio: true }` em caixa, cilindro, extrusão e varredura — o vazio corta as outras peças do
  objeto (aparece translúcido no editor e some na instância). Linhas 2D do objeto aparecem nas instâncias do
  projeto (com tipo, espessura e cor), clicáveis e exportadas no DXF.
- Trechos prontos "Linha 2D", "Círculo 2D", "Eixo de trabalho", "Varredura" e "Vazio" e ajuda da API atualizada.

## [2.6.0] — 2026-10-23 · Estilo de linha, unidades, grade infinita e chat na barra inferior

### Adicionado
- **Tipo, espessura e cor das linhas 2D**: contínua, tracejada, pontilhada, traço e ponto (eixo), traço e dois
  pontos, tracejada longa; espessura por pena em mm (0,13 a 2,0, como no CAD/ABNT); cor livre. No painel de
  propriedades da linha — ou de várias linhas selecionadas de uma vez — e na barra das ferramentas Linha,
  Retângulo e Círculo (estilo das linhas novas). O estilo sincroniza e se mantém ao aparar, estender e fazer canto.
- **Unidade de comprimento do projeto** (m, cm ou mm), no seletor do rodapé: cotas de nível, medidas durante o
  desenho, comprimento digitado, cota dos pontos de edição, mover (ΔX/ΔY/ΔZ e passo), altura das paredes,
  diálogos (nível, extrudar, varrer, eixo de trabalho, grade) e as propriedades de comprimento passam a usar a
  unidade escolhida. Os dados continuam em metros; a unidade vale para todos no projeto.
- **Botão GRADE no rodapé**: mostra/oculta a grade e o ponto base em todas as vistas (preferência de cada
  usuário, guardada no navegador).

### Alterado
- **Grade infinita em todas as vistas** (3D, plantas e elevações): desenhada no shader, sem borda; linhas mais
  fortes a cada 5 e 25 passos, que somem e reaparecem conforme o zoom; na perspectiva, esmaece com a distância.
- **Chat IA na barra inferior**, abaixo da vista, com botão para recolher (▾ Chat IA, ou Ctrl+J) e altura ajustável
  arrastando a borda de cima. Recolhido e altura ficam no preset ativo. A barra da direita abre em Propriedades.

## [2.5.0] — 2026-10-23 · Eixos de trabalho, nível fixo e edição de linhas pelos pontos

### Adicionado
- **Fixar nível (🔒)**: no diálogo do nível (clique duplo na linha) ou no cadeado da tabela NÍVEIS. Nível fixado
  não muda de cota — nem arrastando a linha, nem digitando — até destravar. O rótulo mostra 🔒. Sincroniza com
  quem está no projeto.
- **Eixos de trabalho** (Desenho › Eixo de trabalho): planos de desenho com nome, em qualquer posição —
  vertical clicando dois pontos (planta ou 3D), vertical por origem e ângulo, ou horizontal numa cota. Aparecem
  como um retângulo tracejado com grade de 1 m; o ativo fica laranja. São elementos do projeto (mover, girar,
  apagar, sincronizar). No painel de propriedades: Desenhar neste eixo, Olhar para o eixo (Vista 3D de frente),
  Linha nele. "Plano do nível" volta ao desenho no nível.
- **Desenho 2D nos eixos de trabalho**: Linha, Retângulo, Círculo, Aparar, Estender e Canto trabalham no plano do
  eixo ativo (escolha também na barra da ferramenta: "Plano: nível / Eixo …"); com um eixo ativo dá para desenhar
  também nas elevações. Extrudar levanta o contorno na normal do eixo; Varrer usa o caminho no plano dele.
- **Linha, parede ou viga selecionada**: aparece a cota com a medida e dois pontos nas extremidades. Arraste um
  ponto para mover a ponta (snap nas pontas e meios de linhas, paredes e vigas; ORTO/F8 ou Shift trava 0°/90°;
  passo de 1 cm); clique na medida para digitar o comprimento (a primeira ponta fica). Portas e janelas
  acompanham a parede.

## [2.4.0] — 2026-10-23 · Editar linhas de nível em todas as vistas

### Adicionado
- **Linhas de nível na Vista 3D**: um contorno tracejado em volta do modelo em cada cota, com o rótulo
  "◉ Nome +cota" numa quina. Dá para esconder na tabela de níveis (fica guardado no navegador).
- **Arrastar a linha de nível** (elevações e Vista 3D) muda a cota, com passo de 1 cm (Ctrl: 10 cm). Os
  elementos do nível sobem/descem junto, como no Revit; com Shift, só a linha muda. O rodapé mostra a cota
  durante o arraste e o cursor vira ↕ em cima das linhas.
- **Clique duplo na linha** (ou no rótulo/cabeça) abre o nível: nome, cota, "mover junto os elementos" e Apagar.
  O ✎ do navegador de projeto abre o mesmo diálogo.
- **Botão NÍVEIS no rodapé** (em todas as vistas, inclusive plantas): tabela com nome, cota e número de
  elementos de cada nível — editar direto, + Novo nível, ✕ apagar, abrir a planta.
- Comando **Editar níveis** para colocar nas abas da faixa (Personalizar menus).

### Alterado
- Rótulos de nível mantêm o tamanho na tela também na perspectiva.

## [2.3.0] — 2026-10-23 · Abas todas padronizadas; desenho 2D como objetos

### Alterado
- **Não há mais aba fixa.** Todas as abas da faixa vêm do preset e são iguais: renomear, reordenar, apagar,
  com grupos e ferramentas escolhidos por você (Personalizar menus). Presets existentes viram uma aba
  "Início" comum, com os seus grupos e os que antes apareciam fixos (Arquivo, Modelar, Desenho, Modificar,
  Vistas). Novo botão "+ Abas de cada grupo" cria uma aba para cada grupo de ferramentas do BoxBim (Importar,
  Exportar, Revit, Objetos, IA…), para escolher e reorganizar.
- **Linha, Retângulo e Círculo são Objetos** (categoria Desenho 2D, com miniatura, preço e ícone): estão na
  biblioteca e nos grupos da faixa; inserir abre a ferramenta de desenho. Como comandos, saíram — presets que
  tinham esses comandos passam a ter os objetos.

### Corrigido
- Comandos com id longo (Render, Unreal) sumiam ao gravar o preset.

## [2.2.0] — 2026-10-23 · Desenho 2D, extrusão, varredura e corte por vazio

### Adicionado
- Grupo **Desenho** na aba Início (todos os comandos também entram nos menus personalizados):
  - **Linha** (L): polilinha no plano do nível — comprimento digitado + Enter, C fecha, ORTO (F8), snap em
    pontas, meios, centros, quadrantes e pontas de parede. **Retângulo** e **Círculo**.
  - **Seleção**: clique, **janela** (arrastar para a direita: só o que está inteiro dentro) e **cruzamento**
    (arrastar para a esquerda: o que encosta); Shift soma.
  - **Aparar** (T): clique no trecho a remover; as outras linhas cortam (retas, arcos e círculos).
  - **Estender** (E): a reta vai até a próxima linha à frente da ponta clicada.
  - **Canto**: entre duas retas, **vivo** (sem raio), **arredondado** (raio) ou **chanfro** (distância e
    ângulo em graus); fica o lado clicado de cada linha.
  - **Extrudar**: contornos fechados das linhas selecionadas viram sólidos (altura, deslocamento da base,
    material); contornos internos viram furos.
  - **Varrer**: um perfil percorre o caminho das linhas selecionadas (retângulo, círculo ou um contorno
    desenhado), com juntas em esquadria nas quinas; caminho aberto ou fechado.
  - **Objeto vazio** (opção ao extrudar ou varrer): sólido vermelho translúcido que **corta** os elementos
    com **Cortar com vazio** (selecione o vazio e as peças); **Tirar corte** desfaz. O furo acompanha quando o
    vazio ou a peça se movem, e sobrevive à peça ser refeita (parede de sistema, tipo trocado).
- Linhas, sólidos, vazios e cortes são elementos do projeto: gravados no banco e sincronizados em tempo real.

### Detalhes
- Corte booleano com three-bvh-csg 0.0.18 (versão fixa). Peças cortadas mostram só as quinas reais.
- Vazios não recebem preenchimento de corte nas plantas, somem no estilo Render e não vão para o IFC (o furo já
  está na malha da peça). Linhas de desenho também não vão para o IFC.

## [2.1.2] — 2026-10-22 · Vistas e estilos no rodapé

### Alterado
- Os botões de vista (**ISO, Topo, Frente, Lado, Enquadrar**), **Perspectiva/Ortogonal** e os **estilos**
  (Arame, Projeto, Colorido, Transparente, Render) saíram de cima da vista e foram para o **rodapé**, ao lado
  do status. O topo da vista fica livre (só o nome da vista). Com o rodapé estreito, os estilos mostram só o
  ícone (o nome aparece ao passar o mouse).

## [2.1.1] — 2026-10-22 · Opções de mover no fim da faixa

### Alterado
- Ao selecionar um elemento, as opções de **Mover/Girar** (ΔX ΔY ΔZ, Aplicar, Encaixe, Desfazer, Girar,
  Ao selecionar, Sair) aparecem **no fim da faixa**, à direita dos grupos de ferramentas, em vez de flutuar na
  vista; somem ao limpar a seleção. Com a faixa recolhida, continuam visíveis logo abaixo das abas.

## [2.1.0] — 2026-10-22 · Presets de menus e janelas; barras laterais recolhíveis

### Alterado
- A faixa ficou só com a aba **Início** (seus grupos + Arquivo, Modelar, Modificar e Vistas). As abas
  Minhas, Arquivos, Objetos, Revit e IA saíram: você cria as próprias abas, com nome, e escolhe os grupos e as
  ferramentas de cada uma (botão **+** ao lado das abas, ou Personalizar menus). Todos os comandos antigos
  continuam disponíveis para pôr nas suas abas.

### Adicionado
- **Presets de menus e janelas** no canto superior direito: cada preset guarda as abas da faixa (com grupos
  nomeados de comandos e objetos) e o arranjo das janelas — faixa e barras laterais recolhidas, largura da
  barra da direita, aba aberta à direita. Trocar de preset troca tudo de uma vez; o que você muda nas janelas
  é gravado no preset ativo. Novo preset (cópia do atual), renomear, apagar. Ficam no banco, por usuário
  (tabela `presets`); no primeiro acesso, o preset "Padrão" nasce dos seus conjuntos de ferramentas.
- **Recolher as barras da esquerda e da direita** (‹ ›, como a faixa; Ctrl+[ e Ctrl+]); recolhidas, uma alça
  na borda da vista as traz de volta.
- **Personalizar menus**: abas (criar, renomear, ordenar, apagar) → grupos (criar, renomear, ordenar, mover de
  aba) → comandos e objetos (escolher, ordenar, filtrar).

## [2.0.1] — 2026-10-22 · Laje, pilar, viga, caixa e parede só como objetos

### Alterado
- Saíram da faixa os comandos **Laje, Pilar, Viga, Caixa, Parede coord. e Desenhar parede**, e os atalhos de
  tipos **Paredes, Pisos, Pilares, Vigas** (o grupo Tipos acabou). Esses elementos agora são só **Objetos**:
  biblioteca, conjuntos de ferramentas do usuário e "Inserir objeto".
- Os **tipos e camadas** abrem pelo próprio objeto: botão "Tipos e camadas" nos cartões de Parede, Laje, Pilar
  e Viga da biblioteca (e no painel Propriedades do elemento). Fica um único "Tipos e camadas" na aba Objetos.
- Conjuntos de ferramentas que tinham esses comandos são convertidos sozinhos: viram os objetos
  correspondentes (Parede coord./Desenhar parede → Parede); os atalhos de tipos saem.

## [2.0.0] — 2026-10-22 · BoxBim no navegador, em equipe

### Mudou de plataforma
- **O BoxBim agora roda no navegador.** O app desktop (Electron) foi removido; um servidor Node (Express)
  serve as páginas, a API e a colaboração em tempo real. `BoxBim.cmd` (ou `npm start`) sobe o servidor e abre
  `http://localhost:3000`; outras pessoas da rede entram pelo endereço que o servidor mostra ao iniciar.
  Funciona também num servidor na internet: aí as pontes com Revit, Unreal e o abrir pastas ficam desligadas
  (só funcionam quando o BoxBim é aberto no próprio computador do servidor); Blender e ODA convertem para
  todos.
- **Banco de dados SQLite com o ORM Sequelize** (`<dados>/.servidor/boxbim.sqlite`): usuários, sessões,
  projetos, participantes, elementos, biblioteca de objetos, cópias de objetos por projeto, configurações e
  conjuntos de ferramentas. Usa o SQLite embutido no Node 24 (`node:sqlite`) por um adaptador próprio — sem
  módulo nativo para compilar.
- **Login e cadastro** (senha com scrypt, sessão em cookie HttpOnly). A primeira conta vira administradora:
  só ela altera as configurações do servidor (chaves de IA, caminhos de ferramentas). As chaves passam a ser
  cifradas com AES-256-GCM por uma chave do servidor — **as chaves da versão desktop precisam ser digitadas de
  novo** (estavam cifradas pelo Windows).
- **Projetos com dono e participantes**: página "Projetos" (meus e compartilhados comigo, com miniatura;
  criar, renomear, duplicar, compartilhar, excluir, sair). O dono convida pelo e-mail como **editor** (modela
  junto) ou **leitor** (só vê).
- **Modelagem em tempo real**: cada elemento é gravado no banco e enviado na hora a quem está no projeto
  (WebSocket). Avatares de quem está online, a seleção de cada um destacada na cor dele, aviso de quem alterou
  o quê, reconexão automática. Paredes, lajes, pilares, vigas e caixas viajam pelos dados de modelagem;
  objetos pelo objeto + parâmetros; geometria importada como malha.
- "Modelo" passou a se chamar **Projeto** em toda a interface.
- **Projeto novo começa só com o Nível 0**; os outros níveis o usuário cria depois (Nível 1, Nível 2…).
- Arquivos: abrir envia o arquivo ao servidor (pasta de trabalho do usuário); salvar/exportar baixa pelo
  navegador.

### Adicionado
- **Grade e ponto base em todas as vistas** (3D no chão, plantas na cota do nível, elevações num plano
  vertical de frente para quem olha), com espaçamento e visibilidade do projeto (menu Vista).
- **Estilos de vista em todas as vistas**: **Arame** (só as linhas, tudo vazado), **Projeto** (desenho técnico:
  faces brancas, linhas pretas, papel, corte cinza), **Colorido** (uma cor por categoria, editável no projeto),
  **Transparente** (as mesmas cores, translúcidas) e **Render** (o render em tempo real, agora em qualquer vista;
  a vista {Render} separada saiu).
- **Vistas 3D: botão Perspectiva/Ortogonal** (a ortogonal gira como a perspectiva).
- **Preço nos Objetos** (preço por un, m, m², m³, kg, conjunto ou hora; moeda), por projeto ou na biblioteca
  geral; o painel Propriedades mostra preço, quantidade e total do elemento; **Orçamento** do projeto
  (quantidade × preço por objeto, CSV).
- **Ícone personalizado nos Objetos** (emoji ou imagem/SVG), usado na biblioteca e nas ferramentas.
- **Biblioteca de objetos com miniaturas**: no editor (busca, categoria, preço, ícone; cópia do projeto ou
  geral; "Publicar" leva a versão do projeto para a geral) e na página **Biblioteca de objetos**. As miniaturas
  são desenhadas no navegador e guardadas no banco.
- **Ferramentas do usuário**: conjuntos com nome e com os comandos e objetos que cada um escolhe, no começo da
  aba Início e na aba "Minhas" (Personalizar ferramentas). Primeiro acesso: conjunto "Elementos" com Parede,
  Laje, Pilar, Viga, Caixa e Orto.

### Alterado
- Parede, Laje, Pilar, Viga e Caixa saíram do grupo/menu Modelar: são Objetos (biblioteca e ferramentas do
  usuário); escolher um deles abre a ferramenta própria (parede desenhada com o mouse etc.).
- Cada projeto guarda cópias dos objetos que usa: editar, mudar preço ou ícone no projeto não afeta os outros.

### Corrigido
- O preenchimento de corte (poché) das plantas não era desenhado: a tampa do corte não estava nas camadas de
  render usadas na passada de cada cor.

### Segurança
- Scripts de Objetos continuam num Worker isolado, agora também sem rede pelo cabeçalho CSP do servidor.
- Arquivos: cada usuário só lê/grava na própria pasta de trabalho do servidor. Pedidos de outra origem são
  recusados; tentativas de login são limitadas por IP.

## [1.12.0] — 2026-10-22 · Vista Render (materiais em tempo real) e ponte com o Unreal (DLSS)

### Adicionado
- **Vista {Render}** (Vistas 3D, faixa Início › Vistas › Render): os materiais renderizados em tempo real.
  - Céu procedural (Dia claro, Entardecer, Nublado) como fundo e luz ambiente; **sol** com azimute e altura,
    sombras ajustadas à área que a sombra ocupa no chão; chão de grama ou neutro.
  - **Oclusão ambiente** (GTAO), tonemapping AgX e exposição.
  - **Materiais PBR**: cada material da biblioteca ganha rugosidade, metal, transmissão (vidro), textura
    procedural (concreto, reboco, tijolo, cerâmica, madeira, metal escovado, pedra, grama) e escala em metros.
    As texturas são geradas pelo app (sem arquivos) e projetadas em coordenadas do mundo (triplanar) — a escala
    é real em qualquer peça.
  - **Painel Propriedades › Materiais (render)**: com a vista Render aberta, edite cor, rugosidade, metal,
    vidro, textura e escala do material do elemento selecionado e veja na hora; fica gravado em `tipos.json`.
  - **Path tracing** (Qualidade › Path tracing): luz global, reflexos e vidro corretos, acumulando amostras
    (three-gpu-pathtracer). A primeira compilação do shader leva até ~40 s; mexer na câmera recomeça.
  - **Salvar imagem** (PNG) direto da barra.
- **Abrir no Unreal (DLSS)** (barra da vista Render e faixa Vistas): o BoxBim não acessa o DLSS (WebGL); o
  Unreal Engine 5 acessa, pelo plugin NVIDIA DLSS. O botão:
  - acha o Unreal instalado (Epic Games Launcher; ou Configurações › Ferramentas › Unreal Engine 5);
  - cria/atualiza o projeto `<dados>/Unreal/<nome>/` com Lumen, ray tracing em hardware, sombras virtuais e
    DirectX 12, e o plugin **DLSS** marcado como opcional (liga sozinho quando instalado; sem ele, TSR);
  - exporta o modelo em glTF com os materiais PBR, a **câmera** da vista e o **sol** e abre o editor;
  - o script `Content/Python/init_unreal.py` importa a cena (Interchange), cria atmosfera, nuvens, luz do céu,
    neblina e pós-processamento, salva o nível `/Game/BoxBim/BoxBim` e liga o DLSS (Super Resolution, Ray
    Reconstruction, Frame Generation). Com o editor já aberto, mandar de novo só reimporta.
  - **DLSS 5** (renderização neural): hoje só nas RTX 50; o suporte às RTX 40 foi anunciado pela NVIDIA sem
    data. Quando sair o plugin, o projeto já está pronto para ele.

### Corrigido
- Sair de uma vista para outra não falha mais quando o fundo da cena é uma textura (céu da vista Render).

### Dependências
- `three-gpu-pathtracer` 0.0.26 e `three-mesh-bvh` 0.9.15 (versões fixas).

## [1.11.0] — 2026-10-22 · Parede, Laje, Pilar, Viga e Caixa são Objetos

### Adicionado
- **Objetos de sistema** na biblioteca: **Parede**, **Laje**, **Pilar**, **Viga** e **Caixa** (`.bbo` com o campo
  `"sistema"`). As ferramentas da faixa Modelar (Desenhar parede, Parede coord., Laje, Pilar, Viga, Caixa), a IA
  (`add_wall`, `add_slab`…) e o menu continuam criando os elementos, mas a **geometria sai do script do objeto** —
  dá para abrir no editor de Objetos, mudar o desenho, acrescentar parâmetros, exportar e importar.
  - O script recebe em `p` os parâmetros dirigidos pelo elemento (comprimento, altura, espessura, largura…) e os
    dados de modelagem: `p.camadas` (camadas do tipo), `p.perfis` (elevação da parede já com os vãos de portas e
    janelas), `p.pontos` (contorno da laje). Cada objeto explica o referencial local no cabeçalho do script.
  - Nova opção `layer` nas peças (`g.extrude(…, { layer: i })`): liga a peça à camada `i` do tipo.
  - Parâmetros acrescentados pelo usuário ficam por instância e aparecem no painel Propriedades.
  - Salvar o objeto no editor atualiza todos os elementos daquele tipo no modelo.
- Painel **Propriedades › Objeto de sistema**: edita comprimento, altura, largura, profundidade, circular,
  material e cor direto no elemento; a espessura fica só leitura quando vem das camadas do tipo.

### Mantido
- Tipos com camadas, vãos de portas/janelas hospedadas, junções das paredes, ORTO, plantas/cortes, exportação
  IFC/Revit/DWG: os elementos guardam os mesmos dados de antes. Sem o objeto na biblioteca (ou com erro no
  script), o elemento usa a geometria padrão e um aviso aparece.
- **Orto** (modo de desenho) e **Nível** (referência de cota) não são objetos.

### Alterado
- A Caixa passou a ser um grupo como os outros elementos (antes era uma malha solta).
- Inserir um objeto de sistema pela biblioteca abre a ferramenta correspondente; `place_object` da IA indica
  a ferramenta certa.

## [1.10.0] — 2026-10-22 · Pivô do gizmo no ponto desejado

### Adicionado
- **Botão direito** num ponto da vista põe o pivô do gizmo ali, sem menu: encaixa na quina, no meio de aresta,
  no centro de face ou no centro mais próximo (até 14 px) de qualquer elemento visível; longe deles, usa o
  ponto clicado da superfície. Com a seleção vazia, o botão direito também seleciona o elemento clicado; com
  algo selecionado, a seleção fica (o pivô pode ir para um ponto de outro elemento, para alinhar).
- **Alt + arrastar** a seta (ou o plano) do gizmo move **só o pivô**, encaixando nos mesmos pontos (marca
  amarela); o elemento não se move e nada entra no Desfazer.
- O pivô escolhido acompanha o elemento ao mover e girar (girar 90° em torno da quina gira "na quina") e volta
  ao padrão (centro para mover, centro da base para girar) quando a seleção muda.
- Funciona na vista 3D, nas plantas de piso e de forro e nas elevações. Arrastar com o botão direito continua
  sendo pan.

### Alterado
- O botão direito não altera mais a seleção por acidente (antes um clique direito no vazio limpava a seleção).

## [1.9.1] — 2026-10-22 · Opções de mover em todas as vistas

### Corrigido
- **Plantas de piso, plantas de forro e elevações**: ao selecionar um elemento, o gizmo e a barra de mover
  aparecem como na vista 3D. O gizmo agora é desenhado numa camada por cima da vista, sem o recorte do plano
  de corte — antes, num pilar ou parede cujo centro ficava acima do corte (+1,20), o gizmo sumia na planta.
- A barra de mover/girar fica **embaixo** da vista (antes cobria o rótulo da vista no topo) e ocupa a largura
  disponível de forma centralizada.
- As caixas de seleção da barra (Encaixe, Ao selecionar) ficaram compactas.

## [1.9.0] — 2026-10-22 · Opções de mover ao selecionar

### Adicionado
- **Ao selecionar** qualquer elemento (na vista ou na árvore), o gizmo X/Y/Z e a barra de opções de mover
  aparecem sozinhos, no último modo usado (Mover ou Girar); ao limpar a seleção (clique no vazio ou `Esc`),
  somem. Trocar Mover ↔ Girar (tecla, faixa ou barra) mantém esse comportamento.
- Caixa **Ao selecionar** na barra liga/desliga o comportamento (lembrada entre sessões). Desligada, Mover e
  Girar continuam disponíveis por M/R, faixa e menu.
- Não aparece durante Desenhar parede e Inserir objeto.
- Editor de Objetos: o modo padrão da prévia passa a ser **Mover** — clicar numa peça já mostra o gizmo (e
  continua levando à linha do código).

### Alterado
- `Esc` com as opções de mover abertas também limpa a seleção; o botão **Sair** idem.
- A barra de mover/girar usa a largura disponível e quebra em linhas em telas estreitas (antes rolava e
  escondia botões); textos longos da barra de status terminam em reticências.

## [1.8.0] — 2026-10-22 · Mover e girar com gizmo X/Y/Z; orbitar X/Y/Z

### Adicionado
- **Mover (M)** e **Girar (R)** no projeto (faixa Início › Modificar, menu Modelar) com **gizmo visual**:
  setas X/Y/Z (e planos entre duas setas) para mover; anéis X/Y/Z para girar.
  - Vários elementos de uma vez (Ctrl+clique); girar usa o centro da base da seleção como pivô.
  - **Encaixe sobre o deslocamento** (padrão 0,05 m e 15°, ajustáveis na barra); `Ctrl` durante o arraste
    move livre.
  - Barra de opções com **ΔX ΔY ΔZ** ou **ângulo + eixo** digitados e **Aplicar**.
  - **Ctrl+Z** desfaz os movimentos (até 50); botão Desfazer na barra e na faixa.
  - Nas plantas o gizmo mostra só X/Y (mover) e Z (girar); nas elevações esconde o eixo da direção de visão.
  - Paredes levam junto as portas/janelas que hospedam; porta/janela movida sozinha volta ao eixo da parede.
- **Mover/girar peças no editor de Objetos** (botões ↖ Selecionar, ✥ Mover, ⟳ Girar; teclas V/M/R):
  clique numa peça e arraste o gizmo — o editor **reescreve o código** da linha que criou a peça, somando o
  deslocamento nas opções `{ x, y, z, rotX, rotY, rotZ }` (número vira o novo número; expressão ganha
  `+ 0.1`, acumulando em arrastes seguidos; forma curta `{ x }` vira `x: x + 0.1`; opções que faltam são
  criadas). Todas as peças da mesma linha (laços) se movem juntas e o console avisa quantas foram afetadas.
  Dentro de `g.at` girado, o deslocamento é convertido para o referencial da chamada. Encaixe 1 cm / 5°.
- **Widget de eixos** no canto da vista 3D e da prévia do editor: mostra a orientação X/Y/Z, olha a partir de
  qualquer ponta de eixo (±X, ±Y, ±Z) com um clique e **orbita a câmera em torno de X, Y ou Z** (↺/↻, 15°;
  Shift = 90°).

### Corrigido
- O snap de ponta da ferramenta Desenhar parede considera paredes movidas ou giradas.

## [1.7.0] — 2026-10-22 · Objetos dentro de objetos, com parâmetros compartilhados

### Adicionado
- **Objetos aninhados** (como as famílias aninhadas do Revit): no script, `g.object('Nome', { valores },
  { x, y, z, rotX, rotY, rotZ })` coloca outro objeto da biblioteca dentro do atual. Pode haver vários níveis.
- **Parâmetros compartilhados**: parâmetros do objeto de dentro com o **mesmo nome** de um parâmetro do objeto
  de fora recebem o valor dele automaticamente; os informados em `valores` têm prioridade.
- Editor de Objetos:
  - Botão **Objeto ▾** (barra Inserir): escolhe um objeto da biblioteca e escreve a chamada `g.object(...)` já
    com os parâmetros dele — os compartilhados indicados num comentário, os demais com o padrão e o rótulo.
  - Seção **Objetos dentro deste** (painel Parâmetros): para cada objeto aninhado, os parâmetros
    **⇄ compartilhados**, **= informados no código** e os que usam o padrão; botões **Abrir** (edita o objeto de
    dentro) e **Trazer parâmetros** (cria no objeto de fora os que faltam, que passam a ser compartilhados).
  - Na prévia, a dica de cada peça mostra de qual objeto aninhado ela vem; o clique leva à linha do `g.object`.
  - Erros dentro de um objeto aninhado mostram o caminho (`"Pilar" › dentro de "Estribo" (linha 2 dele): …`) e
    marcam a linha do `g.object` no script em edição.
- Mudar um objeto da biblioteca atualiza também as instâncias de objetos que o usam dentro deles.
- `g.at` aceita `rotX`, `rotY` e `rotZ` (transformações 3D completas, compostas também entre objetos aninhados).
- Objetos de fábrica: **Barra de aço**, **Estribo** e **Pilar de concreto armado** (barras no contorno e estribos
  como objetos aninhados; `diametro` e `aco` compartilhados com a barra; concreto translúcido opcional para ver a
  armadura; taxa de armadura no console).
- Peças com material da biblioteca respeitam `opacity` (ex.: concreto translúcido).
- Referência circular (um objeto que acaba incluindo a si mesmo) e mais de 8 níveis geram erro claro.
- Skill *objetos-parametricos*, ajuda da API e ferramenta `save_object` documentam `g.object`.

## [1.6.0] — 2026-10-22 · Editor de Objetos em tela cheia

### Alterado
- O **criador/editor de Objetos** virou uma área de trabalho em **tela cheia**, com três painéis:
  - **Parâmetros** (esquerda): um cartão por parâmetro, agrupado por grupo, com o **controle ao vivo**
    (deslizante + número, Sim/Não, lista, material, cor) para testar. O ✎ abre a definição (rótulo, nome no
    código, tipo, padrão, mínimo, máximo, opções, grupo, ordem, remover) e "Usar valor atual como padrão".
    O botão ⤵ insere `p.<nome>` no código; o selo **não usado** avisa parâmetros que o código ainda não lê.
  - **Prévia 3D** (centro): vistas ISO/Frente/Topo/Lado, enquadrar, **Arame**, **Cotas** (caixa e
    L × P × A em metros) e **Vão** (caixa vermelha do `g.opening` de portas/janelas). Passar o mouse mostra o
    nome, o material e a linha da peça; **clicar numa peça seleciona a linha do código que a criou**.
  - **Código** (direita): cores de sintaxe (destaque de `p.<parâmetro>` e `g.<função>`), números de linha,
    marcação da **linha com erro**, indentação automática, `Tab`/`Shift+Tab`, `Ctrl+/` comenta a linha,
    botões **Inserir** com trechos prontos (Caixa, Cilindro, Esfera, Extrusão, Revolução, Repetir,
    Deslocar/girar, Condição, Vão, Mensagem), ajuda da API e **console** (mensagens do `g.log`, resumo da
    execução e erros com "ir para a linha").
  - Painéis de prévia e código redimensionáveis (arraste a divisória).
- Execução **automática** a cada alteração (sem precisar testar), com indicador de estado no cabeçalho
  (✔ peças e tempo / ✖ erro na linha N).
- Cabeçalho com nome editável, categoria por **atalhos** (Mobiliário, Porta, Janela, Escada, Genérico) ou lista
  completa, indicador **●** de alterações não salvas, **Exportar .bbo**, **Salvar e inserir** e **Salvar**.
- **Renomear um parâmetro atualiza o código** (`p.antigo` → `p.novo`); parâmetros novos ganham o nome no código
  a partir do rótulo ("Largura do tampo" → `p.larguraDoTampo`).
- **Novo objeto** começa por um seletor de ponto de partida: Em branco, exemplos para aprender (Luminária
  pendente por revolução, Perfil L por extrusão) ou cópia de qualquer objeto da biblioteca.
- Atalhos: `Ctrl+S` salva, `Ctrl+Enter` executa, `Esc` fecha (pergunta se houver alterações não salvas).

### Adicionado
- O executor isolado registra a linha do script que criou cada peça (usada pela prévia → código).

## [1.5.0] — 2026-10-22 · Portas e janelas hospedadas em paredes

### Adicionado
- **Portas e janelas hospedadas** (como no Revit): Objetos da categoria `IfcDoor`/`IfcWindow`, ou que declaram
  um vão, só são colocados em **paredes** e **abrem o vão** nelas — em todas as camadas do tipo.
  - Na inserção com o mouse, a prévia **gruda no eixo da parede** sob o cursor, alinha com ela e vira para o
    lado do cursor; `R`/`Espaço` invertem o lado; longe de parede, nada é colocado.
  - O vão fica sempre inteiro dentro do comprimento da parede.
  - Painel Propriedades da instância hospedada: parede hospedeira, **centro do vão (m do início)** e
    **Inverter lado** (no lugar da rotação livre).
  - Um parâmetro chamado **`espessuraParede`** recebe automaticamente a espessura da parede hospedeira
    (ao inserir e quando o tipo da parede muda).
  - Mudar parâmetros da porta/janela atualiza o vão; mover a instância a faz voltar para o eixo da parede;
    mover a parede leva junto o que ela hospeda.
  - **Apagar a porta/janela fecha o vão; apagar a parede apaga as portas e janelas que ela hospeda.**
- API dos scripts de Objetos: **`g.opening(largura, altura, { sill, x })`** declara o vão (peitoril `sill`
  acima da base da parede). Porta ou janela sem `g.opening` usa a própria caixa envolvente como vão.
- Geometria das paredes refeita: cada camada é a extrusão do perfil da **elevação** com os recortes
  (portas tocando a base viram recortes, janelas viram furos); vãos sobrepostos, encostados nas pontas ou de
  altura inteira são resolvidos em faixas retangulares.
- **IFC**: cada vão sai como `IfcOpeningElement`, ligado à parede por `IfcRelVoidsElement` e à porta/janela por
  `IfcRelFillsElement`; `IfcDoor`/`IfcWindow` levam `OverallHeight`/`OverallWidth` do vão.
- Ferramenta do agente `place_object` hospeda portas/janelas: `wall` (id) + `offset` (centro do vão, m do
  início da parede) + `flip`, ou só `position` perto de uma parede. `set_object_params`, `set_element_type` e
  `modify_elements` mantêm os vãos sincronizados.
- Objetos de fábrica **Porta simples** e **Janela de correr** na revisão 2 (declaram o vão; o marco da porta
  acompanha a espessura da parede). Cópias de fábrica que você nunca editou são atualizadas sozinhas na
  biblioteca; as editadas ficam como estão.
- Skill *objetos-parametricos* e referência da API do editor documentam objetos hospedados.

### Corrigido
- Limitação da 1.4.0: portas e janelas ficavam sobrepostas às paredes, sem vão.

### Limitações conhecidas
- Planta sem símbolo de giro (arco) da porta; a folha aparece cortada na posição do parâmetro de abertura.
- Girar uma parede (rotação) não reposiciona as portas e janelas hospedadas; mover funciona.

## [1.4.0] — 2026-10-21 · Tipos com camadas, Objetos paramétricos em JavaScript

### Adicionado
- **Indicador de versão** no canto inferior direito (`v1.4.0`); clicando, abre este histórico de versões.
- **Tipos com camadas** (como os tipos compostos do Revit) para **paredes, pisos/lajes, pilares e vigas**:
  - Cada camada tem nome, material, espessura e função (estrutura, núcleo, substrato, isolamento,
    acabamento, membrana). Cada camada é uma malha própria no modelo.
  - Parede: da face externa (à esquerda do sentido de desenho) para a interna. Piso: do topo para o fundo.
    Pilar e viga: a 1ª camada é o núcleo (dimensões da instância); as demais revestem em volta.
  - Tipos de fábrica: Alvenaria 14 + reboco, Alvenaria 9 + reboco, Drywall 95 (lã mineral), Concreto 15,
    Genérica 15; Laje maciça 12 + contrapiso + piso, Laje maciça 10, Piso térreo impermeabilizado,
    Genérica 15; pilares Concreto + reboco, Concreto aparente, Metálico com proteção; vigas Concreto +
    reboco, Concreto aparente, Metálica.
  - **Biblioteca de materiais** (Concreto, Bloco cerâmico, Reboco, Gesso acartonado, Lã mineral, Aço, Vidro,
    Madeira…) com cor e opacidade editáveis.
  - Janela **Tipos e camadas** (faixa › Objetos › Tipos): criar, duplicar, apagar, tornar padrão, editar
    camadas (ordem, material, espessura, função), diagrama da seção e materiais. Salvar atualiza todas as
    instâncias do modelo. Fica em `Documentos\BoxBim\tipos.json`.
  - Propriedades do elemento: seletor de **Tipo** e tabela de camadas; trocar o tipo regenera o elemento.
  - Ferramenta Desenhar parede: escolha do tipo na barra de opções (a espessura vem do tipo).
  - **Plantas cortam por material**: o preenchimento de corte de cada camada usa a cor do material.
  - IFC: cada camada sai como uma face colorida do elemento; propriedades `Tipo` e `Camadas` no Pset.
- **Objetos** — famílias paramétricas do BoxBim, programadas em **JavaScript**:
  - Parâmetros (comprimento, número, inteiro, ângulo, sim/não, texto, opção, material, cor — com padrão,
    mínimo, máximo e grupo) e um script `(p, g)` que gera a geometria com a API `g.box`, `g.cylinder`,
    `g.sphere`, `g.extrude` (planos xy/xz/yz, com furos), `g.revolve`, `g.at` e `g.log`.
  - **Execução isolada**: o script roda num Web Worker sem acesso ao app, aos arquivos ou à rede, com tempo
    limite de 3 s; erros voltam com a linha. O renderer do Electron passou a bloquear qualquer acesso de rede.
  - **Editor de Objetos**: tabela de parâmetros, editor de código (Tab; Ctrl+Enter testa), referência da API,
    prévia 3D ao vivo com controles para cada parâmetro e painel de saída.
  - **Biblioteca de Objetos** (faixa › Objetos › Biblioteca, ou Início › Modelar › Inserir objeto): inserir,
    editar, duplicar, exportar e apagar. Arquivos em `Documentos\BoxBim\objetos\*.bbo`.
  - **Importar e exportar** objetos como arquivos `.bbo` para usar em outros projetos e máquinas; um objeto
    importado com o mesmo id e conteúdo diferente recebe um id novo, sem sobrescrever.
  - **Inserção com o mouse**: a prévia segue o cursor no plano do nível; clique coloca (vários seguidos);
    `R`/`Espaço` gira 90°; `Esc` sai.
  - **Parâmetros por instância** no painel Propriedades (regenera ao mudar), rotação, "Editar objeto" e
    "Inserir outro igual". Editar e salvar um objeto atualiza todas as instâncias dele no modelo.
  - Objetos de fábrica: Mesa retangular, Cadeira, Porta simples (ângulo de abertura), Janela de correr
    (2–4 folhas), Estante (n prateleiras), Escada reta (calcula os degraus e confere Blondel).
  - IFC: instâncias exportadas na classe IFC do objeto, com `Objeto` e os parâmetros no Pset.
- Aba **Objetos** na faixa de opções (grupos Objetos e Tipos) e botão **Inserir objeto** em Início › Modelar.
- Ferramentas do agente: `list_types`, `set_element_type`, `save_type`, `list_objects`, `get_object`,
  `save_object` (testa o script antes de salvar), `place_object` e `set_object_params`; `add_wall`,
  `add_slab`, `add_column` e `add_beam` aceitam `type`.
- Skill **objetos-parametricos** (API e boas práticas), incluída no agente Arquiteto BIM de fábrica.
- Itens de fábrica (agentes, skills, objetos) novos chegam com as atualizações; cada um é copiado uma única
  vez (registro em `.seeded.json`), então o que o usuário apagou não volta.

### Alterado
- Paredes, lajes, pilares e vigas passaram a ser grupos com uma malha por camada. Sem `type`, o elemento usa
  o tipo padrão da categoria; com só `thickness` (parede/laje), é criado genérico com essa espessura.

### Limitações conhecidas
- Portas e janelas ainda não abrem vão nas paredes (ficam sobrepostas) — resolvido na 1.5.0.
- Os cantos entre paredes de tipos diferentes não são limpos camada a camada.

## [1.3.0] — 2026-10-21 · Desenho de paredes e ORTO

### Adicionado
- **Desenhar parede** (atalho `W`, faixa Início › Modelar, menu Modelar): paredes desenhadas com o mouse,
  ponto a ponto, encadeadas como uma polilinha do AutoCAD. Funciona nas plantas de piso, nas plantas de forro
  e na vista 3D, sempre no plano do nível escolhido.
  - Prévia elástica da parede e linha tracejada até o cursor.
  - Dica junto ao cursor com comprimento e ângulo (`4,25 m ∠ 90,0°`), coordenadas no primeiro ponto.
  - **Entrada direta de distância**: com o cursor indicando a direção, digite o comprimento e `Enter`.
  - **Snap de ponta** (marcador laranja) nas pontas das paredes do nível e no ponto inicial da sequência.
  - Sem snap, os pontos são arredondados a 1 cm.
  - `C` fecha o contorno no ponto inicial; `Backspace` desfaz o último trecho;
    `Enter`, botão direito ou clique duplo terminam a sequência; `Esc` termina e, de novo, sai.
  - Barra de opções da ferramenta: Nível, Altura (vazio = até o nível de cima), Espessura (lembrada entre
    sessões), ORTO, Terminar e Sair.
  - Junções: paredes encadeadas têm as pontas prolongadas em meia espessura, fechando os cantos.
  - Durante o desenho: botão do meio arrasta a vista e a roda dá zoom.
- **ORTO** (como no AutoCAD): trava o ângulo do desenho em 0°/90°.
  - `F8` liga/desliga em qualquer momento; `Shift` inverte o estado enquanto pressionado.
  - Botão **ORTO** na barra de status e botão **Orto** na faixa (acesos quando ligado); estado lembrado.
- Versão do aplicativo no título da janela e em Configurações › Sobre.
- Rota `/status` do add-in informa a versão do add-in (`addin`).
- Este `CHANGELOG.md`.

### Alterado
- Paredes guardam o eixo (`userData.bim.wall`: início, fim, altura, espessura, base, prolongamentos),
  usado pelo snap e pelas junções.
- O antigo comando "Parede" passou a se chamar **Parede por coordenadas**.

## [1.2.0] — 2026-10-21 · Barra de ferramentas superior

### Adicionado
- **Faixa de opções** no estilo do Revit, abaixo do menu, com abas:
  - **Início**: Arquivo (Abrir, Captura), Modelar, Vistas (3D, planta de piso/forro e elevação com lista de
    escolha, Enquadrar).
  - **Arquivos**: Importar e Exportar (IFC, DWG, DXF, FBX, Collada, glTF).
  - **Revit**: Trazer/Enviar modelo, Abrir/Salvar .rvt, Trazer/Enviar níveis, Conexão.
  - **IA**: Chat, Agentes, Memória, Configurações.
- **Recolher/mostrar**: botão ︿/﹀, `Ctrl+F1` ou clique duplo numa aba. Recolhida, mostra só as abas; clicar
  numa aba abre a faixa. O estado e a aba ativa são lembrados entre sessões.

## [1.1.0] — 2026-10-21 · Níveis e vistas como no Revit

### Adicionado
- **Níveis** (nome + cota): criar, renomear, mudar a cota e apagar. Cada nível gera uma planta de piso e uma
  planta de forro.
- **Navegador de projeto** no estilo do Revit: Vistas (todas) › Vistas 3D, Plantas de piso, Plantas de forro,
  Elevações (Elevação da construção) Norte/Sul/Leste/Oeste; e a lista de Níveis.
- **Abas de vista**: cada vista abre numa aba e guarda a própria câmera.
- **Vistas estáticas** (câmera ortográfica, só pan e zoom) em fundo de papel, com contornos:
  - Planta de piso com plano de corte (1,20 m) e profundidade (−0,30 m) ajustáveis em Propriedades.
  - **Preenchimento de corte (poché)** por stencil — funciona mesmo com sólidos sobrepostos.
  - Planta de forro vista de baixo e espelhada, na mesma orientação da planta de piso.
  - Elevações com linhas e cabeças de nível (nome + cota), alternando de lado quando próximas.
- **Modelagem hospedada em nível**: base/topo como deslocamentos do nível; paredes e pilares vão até o nível
  de cima por padrão; propriedade `Nivel` nos elementos.
- **IFC com pavimentos**: exporta um `IfcBuildingStorey` por nível; importa pavimentos como níveis
  (com conversão de mm/cm/pés) e o pavimento de cada elemento.
- **Sincronização de níveis com o Revit**: trazer os níveis do projeto ativo; enviar níveis ao Revit
  (cria os que faltam com planta de piso e atualiza a cota dos de mesmo nome).
- Ferramentas do agente: `list_levels`, `add_level`, `modify_level`, `delete_level`, `open_view`,
  `set_view_range`, `revit_sync_levels`; as ferramentas de modelagem aceitam `level`.
- Add-in **1.1.0**: rota `/levels`.

### Corrigido
- Elementos de IFC eram contados duas vezes (as malhas internas viravam elementos).
- Tipos IFC em CamelCase (ex.: `IfcBuildingElementProxy`) apareciam com a grafia errada.

## [1.0.0] — 2026-10-21 · Primeira versão

### Adicionado
- Aplicativo desktop (Electron + three.js) com visualizador 3D (Z para cima, metros), árvore do projeto,
  propriedades, arrastar e soltar arquivos e captura da vista em PNG.
- **Importação/exportação**: IFC (web-ifc / exportador IFC4 próprio), DXF, DWG (via ODA File Converter),
  FBX (importação nativa, exportação via Blender), COLLADA (exportador próprio), glTF, OBJ e STL.
- **Ponte com o Revit 2025** (add-in **BoxBim Bridge 1.0.0**, servidor HTTP local em `127.0.0.1:48884`):
  rotas `/status`, `/summary`, `/export`, `/import`, `/open`, `/ifc-to-rvt`; aba BoxBim na faixa do Revit.
  O levantamento das APIs de importação/exportação do Revit foi feito com o REA sobre a `RevitAPI.dll`.
- **Chat de IA** com loop de ferramentas: Claude (Anthropic), OpenAI, Google Gemini, OpenRouter, Groq,
  DeepSeek, Mistral, xAI e locais (LM Studio, Ollama, llama.cpp) ou qualquer servidor compatível com OpenAI.
  Chaves guardadas com a criptografia do Windows.
- **Agentes** (Markdown com frontmatter), **skills** (`SKILL.md`) e **memória em arquivos Markdown** com
  índice `MEMORY.md`, salvamento automático opcional e conversas exportáveis.
- Agentes e skills de fábrica: Arquiteto BIM, Assistente Local, Coordenador IFC; Modelagem BIM,
  Interoperabilidade com Revit, Verificação de modelo IFC.

[2.3.0]: #230--2026-10-23--abas-todas-padronizadas-desenho-2d-como-objetos
[2.2.0]: #220--2026-10-23--desenho-2d-extrusão-varredura-e-corte-por-vazio
[2.1.2]: #212--2026-10-22--vistas-e-estilos-no-rodapé
[2.1.1]: #211--2026-10-22--opções-de-mover-no-fim-da-faixa
[2.1.0]: #210--2026-10-22--presets-de-menus-e-janelas-barras-laterais-recolhíveis
[2.0.1]: #201--2026-10-22--laje-pilar-viga-caixa-e-parede-só-como-objetos
[2.0.0]: #200--2026-10-22--boxbim-no-navegador-em-equipe
[1.12.0]: #1120--2026-10-22--vista-render-materiais-em-tempo-real-e-ponte-com-o-unreal-dlss
[1.11.0]: #1110--2026-10-22--parede-laje-pilar-viga-e-caixa-são-objetos
[1.10.0]: #1100--2026-10-22--pivô-do-gizmo-no-ponto-desejado
[1.9.1]: #191--2026-10-22--opções-de-mover-em-todas-as-vistas
[1.9.0]: #190--2026-10-22--opções-de-mover-ao-selecionar
[1.8.0]: #180--2026-10-22--mover-e-girar-com-gizmo-xyz-orbitar-xyz
[1.7.0]: #170--2026-10-22--objetos-dentro-de-objetos-com-parâmetros-compartilhados
[1.6.0]: #160--2026-10-22--editor-de-objetos-em-tela-cheia
[1.5.0]: #150--2026-10-22--portas-e-janelas-hospedadas-em-paredes
[1.4.0]: #140--2026-10-21--tipos-com-camadas-objetos-paramétricos-em-javascript
[1.3.0]: #130--2026-10-21--desenho-de-paredes-e-orto
[1.2.0]: #120--2026-10-21--barra-de-ferramentas-superior
[1.1.0]: #110--2026-10-21--níveis-e-vistas-como-no-revit
[1.0.0]: #100--2026-10-21--primeira-versão

---
[BoxHoney By Marcelo Olimpio – Eng. de software v2.17.0](https://marceloolimpio.com.br/)
