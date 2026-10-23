---
name: Modelagem BIM no BoxBim
description: Use ao criar ou editar paredes, lajes, pilares, vigas e volumes no BoxBim
---

# Modelagem BIM no BoxBim

## Convenções
- Unidades em metros; eixo Z para cima; planta no plano XY.
- `add_wall` cresce centrada na linha start→end (a espessura se divide para os dois lados).
- `add_slab` usa `elevation` como cota do TOPO; a laje desce `thickness`.
- `add_beam` usa `top` como cota do topo da viga.

## Medidas usuais (Brasil)
| Elemento | Padrão |
|---|---|
| Parede de alvenaria | 0,15 m (vedação 0,14–0,19 m), pé-direito 2,80–3,00 m |
| Laje maciça | 0,10–0,12 m |
| Pilar | 0,20 × 0,40 m (mínimo 0,19 m na menor dimensão) |
| Viga | 0,15 × 0,40 m |
| Porta | 0,80 × 2,10 m |

## Procedimento
1. `scene_summary` para conhecer o que já existe e os limites do modelo.
2. Crie primeiro lajes, depois pilares, vigas e paredes.
3. Para retângulos de paredes, feche o contorno: (0,0)→(L,0)→(L,P)→(0,P)→(0,0).
4. Termine com `set_view` iso e resuma o que foi criado.
