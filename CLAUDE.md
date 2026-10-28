# BoxBim — regras do projeto

## Toda atualização vira um commit
- Cada pedido concluído (funcionalidade, correção, documentação) termina com **um commit** neste repositório,
  depois de testado. Não acumular várias atualizações num commit só.
- **Mensagem do commit no modelo** `data – especificações do commit - vX.Y.Z`, por exemplo:
  `2026-10-26 – Créditos na lateral direita e AGENT.MD - v2.16.1` (data AAAA-MM-DD, travessão "–", versão do
  `package.json` deste commit). O corpo pode detalhar o que mudou e por quê.
- Antes do commit: `npm run build` sem erros, versão nova no `package.json`, entrada no `CHANGELOG.md`
  (Keep a Changelog, versionamento semântico), o README atualizado quando a mudança é visível ao usuário e o
  **`AGENT.MD` atualizado** (ver abaixo).
- Não fazer push nem criar branches/PRs sem o usuário pedir.

## AGENT.MD — histórico do projeto (sempre atualizar)
O `AGENT.MD` na raiz guarda, em todo commit:
- **Mapa da arquitetura**: diagrama (Mermaid) mostrando como os módulos e as funções principais se ligam
  (navegador ⇄ servidor ⇄ banco ⇄ tempo real ⇄ IA/MCP). Atualizar quando surgir módulo/ligação nova.
- **Lista de cada commit**: data, versão, hash (o do próprio commit fica como "este commit" e ganha o hash no
  commit seguinte) e o resumo do que mudou.

## Créditos
- Na documentação (README, DEPLOY, AGENT.MD) e no rodapé da **lateral direita** do aplicativo, o crédito:
  `<a href="https://marceloolimpio.com.br/">BoxHoney By Marcelo Olimpio – Eng. de software vX.Y.Z</a>`
  — com a versão atual do BoxBim no lugar de vX.Y.Z (no app ela vem do `package.json`).

## Interface
- **Toda ferramenta tem o seu ponteiro**: ao usar uma ferramenta (desenho 2D, aparar, estender, canto, offset, parede,
  piso, telhado, copiar, espelhar, cota, inserir objeto, escolhas na vista…), o ponteiro muda para a mira com o ícone
  dela — `toolCursor('<nome>')` de `renderer/src/cursors.js`. Ferramenta nova = ícone novo em `cursors.js` e
  `el.style.cursor = toolCursor(...)` no início (e `''` no fim). Nunca deixar só `crosshair` genérico.
- Barras de ferramenta ficam **flutuantes e arrastáveis** (`floatBar` de `ui.js`), quadradas e compactas.

## Como testar
- Servidor de teste isolado (nunca o do usuário): `BOXBIM_DATA=<pasta temporária> PORTA=3911 node server/index.js`.
- A instância do BoxBim do próprio usuário (porta 3000, `Documentos\\BoxBim`) não deve ser fechada nem alterada,
  e programas do usuário (ex.: LM Studio na porta 1234) não devem ser usados nos testes.
- Não modificar o Revit sem confirmação; não mudar a política de segurança do npm; nunca usar senhas reais.

## Implantação
- Docker / Easypanel: ver `DEPLOY.md`.
