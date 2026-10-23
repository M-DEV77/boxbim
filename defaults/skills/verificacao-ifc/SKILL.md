---
name: Verificação de modelo IFC
description: Use ao revisar, auditar ou checar a qualidade de um modelo IFC ou Revit
---

# Checklist de verificação

1. `scene_summary` com limite alto: conte elementos por tipo IFC.
2. Sinais de alerta:
   - Muitos `IfcBuildingElementProxy` → classes IFC mal mapeadas no Revit.
   - Elementos sem nome ou com nomes genéricos.
   - Limites do modelo muito longe da origem (> 10 km) → problema de coordenadas compartilhadas.
   - Elementos com caixa envolvente de altura zero.
3. Se o Revit estiver conectado, compare com `revit_summary` (categorias e níveis).
4. Entregue um relatório em tabela: Elemento/Tipo | Problema | Gravidade | Sugestão.
5. Salve com `save_memory` (type project) os problemas recorrentes do projeto.
