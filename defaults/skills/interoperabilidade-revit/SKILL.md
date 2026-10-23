---
name: Interoperabilidade com Revit
description: Use ao importar ou exportar RVT, IFC, DWG, DXF, FBX ou COLLADA, ou ao enviar/trazer modelos do Revit
---

# Rotas de conversão do BoxBim

| Quero… | Caminho | Ferramenta |
|---|---|---|
| Abrir modelo do Revit | Revit exporta IFC → BoxBim importa | `revit_bring_model` (format ifc) |
| Ver materiais do Revit | Revit exporta FBX | `revit_bring_model` (format fbx) |
| Levar o modelo ao Revit mantendo categorias | IFC → Revit converte para RVT e vincula | `revit_send_model` mode link |
| Gerar um .rvt | IFC → Revit salva RVT | `export_model` format rvt |
| DWG | DXF ↔ ODA File Converter; ou o Revit exporta DWG | `export_model` dwg / `revit_export` dwg |
| FBX | glTF → Blender → FBX | `export_model` fbx |
| COLLADA (.dae) | exportador nativo do BoxBim | `export_model` dae |

## Limitações a avisar
- O Revit precisa estar aberto com o add-in BoxBim Bridge; confira com `revit_status`.
- O Revit não importa FBX nem COLLADA: para mandar geometria desses formatos ao Revit, converta para IFC (padrão) ou DXF.
- Geometria vinda de malhas (FBX, OBJ, DAE) chega ao Revit como forma importada, não como família paramétrica.
- DWG sem o ODA File Converter: use a rota pelo Revit.
