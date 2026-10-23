---
name: Objetos paramétricos e tipos com camadas
description: Use ao criar, programar, editar ou inserir Objetos (famílias paramétricas em JavaScript) e ao escolher ou criar tipos de parede, piso, pilar e viga com camadas
---

# Objetos paramétricos (famílias do BoxBim)

Um **Objeto** é uma família paramétrica: uma lista de parâmetros + um script em **JavaScript** que desenha a
geometria. Fica na biblioteca como arquivo `.bbo` e pode ser exportado/importado entre projetos.

## Fluxo
1. `list_objects` para ver o que já existe (não duplique).
2. Para criar: `save_object` com `name`, `category` (classe IFC), `parameters` e `script`.
   O BoxBim executa o script com os valores padrão antes de salvar; se der erro, corrija a linha indicada.
3. Para usar no projeto: `place_object` (posição [x, y] em metros, `rotation` em graus, `level`, `params`).
4. Para alterar uma instância: `set_object_params` com o id do elemento.

## Objetos dentro de objetos (aninhados) e parâmetros compartilhados
- `g.object('Barra de aço', { comprimento: H - 2 * c }, { x, y, z })` coloca outro objeto da biblioteca dentro
  do atual (como as famílias aninhadas do Revit). Ex.: o *Pilar de concreto armado* usa *Barra de aço* e *Estribo*.
- **Compartilhamento**: parâmetros do objeto de dentro com o **mesmo nome** de um parâmetro do objeto de fora
  recebem o valor dele automaticamente (ex.: `diametro`, `aco`). Valores informados no 2º argumento têm prioridade.
- Cuidado com nomes genéricos (`material`, `largura`): se o de fora tiver o mesmo nome, o valor passa para dentro.
- Mudar o objeto de dentro atualiza todos os objetos e instâncias que o usam. Referência circular dá erro.

## Portas e janelas (objetos hospedados)
- Categoria `IfcDoor`/`IfcWindow` ou script com `g.opening(...)` = objeto **hospedado**: só é colocado numa
  parede, alinhado ao eixo dela (X local ao longo da parede, Y local na espessura) e abre o vão em todas as camadas.
- Declare o vão com `g.opening(largura, altura, { sill })` (sill = peitoril acima da base da parede). Sem
  isso, uma porta/janela usa a própria caixa envolvente como vão.
- Um parâmetro chamado `espessuraParede` recebe automaticamente a espessura da parede hospedeira.
- `place_object` com `wall` (id) e `offset` (centro do vão, m do início da parede), ou só `position` perto da parede.

## Parâmetros
`{ name, label, type, default, min, max, options, group }` — `name` é o identificador usado no script (`p.name`).

| type | valor no script |
|---|---|
| comprimento | número em **metros** |
| numero / inteiro | número (inteiro é arredondado) |
| angulo | número em **graus** |
| booleano | true / false |
| texto | string |
| opcao | string, uma das `options` (lista separada por `;`) |
| material | nome de material da biblioteca (Madeira, Aço, Concreto, Vidro, Reboco…) |
| cor | `#rrggbb` |

## API do script — corpo de uma função `(p, g)`
Metros, graus, **Z para cima**; a origem (0, 0, 0) é o ponto de inserção no piso do nível.
Toda função aceita `opts = { x, y, z, rotX, rotY, rotZ, material, color, opacity, name }`.

| Função | O que faz |
|---|---|
| `g.box(largura, profundidade, altura, opts)` | caixa com a **base** centrada em (x, y, z) |
| `g.cylinder(raio, altura, { rTop, segments, ... })` | cilindro/tronco de cone vertical, base em (x, y, z) |
| `g.sphere(raio, opts)` | esfera com centro em (x, y, z) |
| `g.extrude(perfil, altura, { plane, holes, ... })` | perfil `[[u, v], …]` extrudado: `plane` 'xy' sobe em Z (padrão), 'xz' avança em +Y, 'yz' avança em +X |
| `g.revolve(perfil, { segments, angle, ... })` | perfil `[[raio, z], …]` girado em torno de Z |
| `g.at({ x, y, z, rotZ }, () => { ... })` | desenha com a origem deslocada/girada (repetições, folhas de porta) |
| `g.opening(largura, altura, { sill, x })` | vão que o objeto abre na parede hospedeira (portas e janelas) |
| `g.object('Nome', { valores }, { x, y, z, rotX, rotY, rotZ })` | coloca outro objeto da biblioteca dentro deste (objeto aninhado) |
| `g.log(...)` | mensagem no painel de saída (cálculos, conferências) |

O script roda isolado (sem acesso a arquivos, rede ou ao app) e é interrompido após 3 s.

### Exemplo
```js
// Banco com assento e duas pernas em placa
const e = 0.04;
g.box(p.comprimento, p.profundidade, e, { z: p.altura - e, material: p.material, name: 'Assento' });
for (const sx of [-1, 1]) {
  g.box(e, p.profundidade, p.altura - e, { x: sx * (p.comprimento / 2 - 0.1), material: p.material, name: 'Perna' });
}
g.log('Comprimento:', p.comprimento, 'm');
```
Boas práticas: nomeie as peças (`name`), derive medidas dos parâmetros (nada de números soltos para o que o
usuário pode querer mudar), use `min`/`max` realistas e `g.log` para conferências normativas.

# Tipos com camadas (paredes, pisos, pilares, vigas)
- `list_types` mostra os tipos e camadas (material e espessura).
- `add_wall`, `add_slab`, `add_column`, `add_beam` aceitam `type` (nome ou id). Sem `type`, usam o tipo ativo;
  só com `thickness` (parede/laje), criam um elemento genérico.
- `set_element_type` troca o tipo de elementos existentes.
- `save_type` cria/atualiza um tipo: parede da face **externa → interna**; piso **topo → fundo**;
  pilar/viga: a 1ª camada é o **núcleo** (espessura 0, dimensões da instância) e as demais revestem.
