using Path = System.IO.Path;
using File = System.IO.File;
using Directory = System.IO.Directory;
using FileNotFoundException = System.IO.FileNotFoundException;
using System.Text.Json.Nodes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace BoxBimBridge
{
    /// <summary>
    /// Rotas da ponte. Todas rodam na thread principal do Revit.
    ///   /status   → versão do Revit e documento ativo
    ///   /summary  → contagem de elementos por categoria e níveis
    ///   /export   → exporta o documento ativo (ou um .rvt em segundo plano) para ifc|dwg|dxf|fbx|obj|stl
    ///   /import   → importa/vincula ifc|dwg|dxf|obj|stl|skp|sat|step|3dm|rvt no documento ativo
    ///   /open     → abre .rvt ou .ifc como documento ativo
    ///   /ifc-to-rvt → converte um IFC em .rvt
    /// </summary>
    public static class Commands
    {
        public static object Dispatch(UIApplication uiapp, string route, JsonObject req) => route switch
        {
            "/status" => Status(uiapp),
            "/summary" => Summary(uiapp),
            "/export" => Export(uiapp, req),
            "/import" => Import(uiapp, req),
            "/open" => Open(uiapp, req),
            "/ifc-to-rvt" => IfcToRvt(uiapp, req),
            "/levels" => SetLevels(uiapp, req),
            _ => throw new ArgumentException($"Rota desconhecida: {route}")
        };

        private static string Str(JsonObject req, string key, string def = null) =>
            req.TryGetPropertyValue(key, out var v) && v != null ? v.ToString() : def;

        private static bool Bool(JsonObject req, string key, bool def = false) =>
            req.TryGetPropertyValue(key, out var v) && v != null && bool.TryParse(v.ToString(), out var b) ? b : def;

        private static Document ActiveDoc(UIApplication uiapp) =>
            uiapp.ActiveUIDocument?.Document ?? throw new InvalidOperationException("Nenhum documento aberto no Revit.");

        // ---------------------------------------------------------------- status / summary

        private static object Status(UIApplication uiapp)
        {
            var doc = uiapp.ActiveUIDocument?.Document;
            return new Dictionary<string, object>
            {
                ["ok"] = true,
                ["revit"] = uiapp.Application.VersionName,
                ["build"] = uiapp.Application.VersionBuild,
                ["port"] = App.Server?.Port ?? App.DefaultPort,
                ["addin"] = typeof(App).Assembly.GetName().Version?.ToString(3),
                ["document"] = doc == null ? null : new Dictionary<string, object>
                {
                    ["title"] = doc.Title,
                    ["path"] = doc.PathName,
                    ["isFamily"] = doc.IsFamilyDocument,
                    ["activeView"] = uiapp.ActiveUIDocument.ActiveView?.Name
                }
            };
        }

        private static object Summary(UIApplication uiapp)
        {
            var doc = ActiveDoc(uiapp);
            var counts = new Dictionary<string, int>();
            foreach (var e in new FilteredElementCollector(doc).WhereElementIsNotElementType())
            {
                var cat = e.Category;
                if (cat == null || cat.CategoryType != CategoryType.Model) continue;
                counts[cat.Name] = counts.TryGetValue(cat.Name, out var c) ? c + 1 : 1;
            }
            var levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
                .OrderBy(l => l.Elevation)
                .Select(l => new Dictionary<string, object> { ["name"] = l.Name, ["elevation_m"] = Math.Round(UnitUtils.ConvertFromInternalUnits(l.Elevation, UnitTypeId.Meters), 3) })
                .ToList();
            return new Dictionary<string, object>
            {
                ["ok"] = true,
                ["title"] = doc.Title,
                ["categories"] = counts.OrderByDescending(kv => kv.Value).ToDictionary(kv => kv.Key, kv => kv.Value),
                ["levels"] = levels
            };
        }

        // ---------------------------------------------------------------- níveis

        /// <summary>
        /// Cria os níveis que faltam (com planta de piso) e atualiza a cota dos que têm o mesmo nome.
        /// Níveis do Revit com outros nomes não são tocados.
        /// </summary>
        private static object SetLevels(UIApplication uiapp, JsonObject req)
        {
            var doc = ActiveDoc(uiapp);
            var items = req["levels"] as JsonArray ?? throw new ArgumentException("Informe 'levels': [{ name, elevation }].");
            var createPlans = Bool(req, "createPlans", true);
            var existing = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().ToList();
            var planType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                .FirstOrDefault(t => t.ViewFamily == ViewFamily.FloorPlan);

            int created = 0, updated = 0, plans = 0;
            using var t = new Transaction(doc, "BoxBim: níveis");
            t.Start();
            foreach (var node in items)
            {
                var name = node?["name"]?.ToString();
                if (string.IsNullOrWhiteSpace(name)) continue;
                var feet = UnitUtils.ConvertToInternalUnits(node["elevation"].GetValue<double>(), UnitTypeId.Meters);
                var level = existing.FirstOrDefault(l => l.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
                if (level == null)
                {
                    level = Level.Create(doc, feet);
                    try { level.Name = name; } catch { /* nome em uso por outro elemento: fica o nome automático */ }
                    existing.Add(level);
                    created++;
                    if (createPlans && planType != null) { ViewPlan.Create(doc, planType.Id, level.Id); plans++; }
                }
                else if (Math.Abs(level.Elevation - feet) > 1e-6)
                {
                    level.Elevation = feet;
                    updated++;
                }
            }
            t.Commit();
            return Ok(new() { ["created"] = created, ["updated"] = updated, ["plans"] = plans });
        }

        // ---------------------------------------------------------------- export

        private static object Export(UIApplication uiapp, JsonObject req)
        {
            var format = (Str(req, "format", "ifc")).ToLowerInvariant();
            var folder = Str(req, "folder") ?? Path.Combine(Path.GetTempPath(), "BoxBim");
            Directory.CreateDirectory(folder);
            var rvtPath = Str(req, "path");

            Document doc;
            bool background = !string.IsNullOrEmpty(rvtPath);
            if (background)
            {
                if (!File.Exists(rvtPath)) throw new FileNotFoundException("Arquivo não encontrado", rvtPath);
                var open = uiapp.Application.Documents.Cast<Document>()
                    .FirstOrDefault(d => string.Equals(d.PathName, rvtPath, StringComparison.OrdinalIgnoreCase));
                if (open != null) { doc = open; background = false; }
                else doc = uiapp.Application.OpenDocumentFile(rvtPath);
            }
            else doc = ActiveDoc(uiapp);

            var name = Str(req, "name") ?? SafeName(doc.Title);
            try
            {
                var before = new HashSet<string>(Directory.GetFiles(folder), StringComparer.OrdinalIgnoreCase);
                bool ok;
                switch (format)
                {
                    case "ifc":
                        ok = ExportIfc(doc, folder, name, Str(req, "ifcVersion", "IFC4"), Bool(req, "visibleOnly"));
                        break;
                    case "dwg":
                    case "dxf":
                        ok = ExportCad(doc, folder, name, format, Str(req, "setup"));
                        break;
                    case "fbx":
                        {
                            var view = Get3DView(doc);
                            var set = new ViewSet();
                            set.Insert(view);
                            ok = doc.Export(folder, name, set, new FBXExportOptions());
                            break;
                        }
                    case "obj":
                        ok = doc.Export(folder, name, new OBJExportOptions());
                        break;
                    case "stl":
                        ok = doc.Export(folder, name, new STLExportOptions());
                        break;
                    default:
                        throw new ArgumentException($"Formato de exportação não suportado pelo Revit: {format}");
                }

                var files = Directory.GetFiles(folder)
                    .Where(f => !before.Contains(f) || Path.GetFileNameWithoutExtension(f).StartsWith(name, StringComparison.OrdinalIgnoreCase))
                    .Where(f => Path.GetFileName(f).StartsWith(name, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                return new Dictionary<string, object> { ["ok"] = ok, ["format"] = format, ["document"] = doc.Title, ["files"] = files };
            }
            finally
            {
                if (background) doc.Close(false);
            }
        }

        private static bool ExportIfc(Document doc, string folder, string name, string version, bool visibleOnly)
        {
            var opts = new IFCExportOptions
            {
                FileVersion = version.ToUpperInvariant() switch
                {
                    "IFC2X3" => IFCVersion.IFC2x3CV2,
                    "IFC4RV" => IFCVersion.IFC4RV,
                    "IFC4DTV" => IFCVersion.IFC4DTV,
                    _ => IFCVersion.IFC4
                },
                ExportBaseQuantities = true
            };
            if (visibleOnly) opts.FilterViewId = Get3DView(doc).Id;
            opts.AddOption("ExportInternalRevitPropertySets", "true");
            opts.AddOption("ExportIFCCommonPropertySets", "true");

            // A exportação IFC precisa de uma transação aberta; desfazemos no final para não sujar o projeto.
            using var t = new Transaction(doc, "BoxBim: exportar IFC");
            t.Start();
            var ok = doc.Export(folder, name, opts);
            t.RollBack();
            return ok;
        }

        private static bool ExportCad(Document doc, string folder, string name, string format, string setup)
        {
            var view = Get3DView(doc);
            var views = new List<ElementId> { view.Id };
            if (format == "dxf")
            {
                var dxf = new DXFExportOptions();
                return doc.Export(folder, name, views, dxf);
            }
            var dwg = (!string.IsNullOrEmpty(setup) ? DWGExportOptions.GetPredefinedOptions(doc, setup) : null) ?? new DWGExportOptions();
            return doc.Export(folder, name, views, dwg);
        }

        private static View3D Get3DView(Document doc)
        {
            var views = new FilteredElementCollector(doc).OfClass(typeof(View3D)).Cast<View3D>()
                .Where(v => !v.IsTemplate && !v.IsPerspective).ToList();
            var view = views.FirstOrDefault(v => v.Name.Contains("{3D}")) ?? views.FirstOrDefault();
            if (view != null) return view;

            var vft = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                .First(t => t.ViewFamily == ViewFamily.ThreeDimensional);
            using var t = new Transaction(doc, "BoxBim: vista 3D");
            t.Start();
            view = View3D.CreateIsometric(doc, vft.Id);
            view.Name = "BoxBim 3D";
            t.Commit();
            return view;
        }

        // ---------------------------------------------------------------- import / open

        private static object Import(UIApplication uiapp, JsonObject req)
        {
            var path = Str(req, "path") ?? throw new ArgumentException("Informe 'path'.");
            if (!File.Exists(path)) throw new FileNotFoundException("Arquivo não encontrado", path);
            var format = (Str(req, "format") ?? Path.GetExtension(path).TrimStart('.')).ToLowerInvariant();
            var link = Bool(req, "link");

            if (format == "ifc")
            {
                var rvt = ConvertIfc(uiapp, path, Str(req, "rvtPath"));
                if (Bool(req, "open")) { uiapp.OpenAndActivateDocument(rvt); return Ok(new() { ["rvt"] = rvt, ["mode"] = "open" }); }
                return LinkRvt(uiapp, rvt);
            }
            if (format == "rvt")
            {
                if (Bool(req, "open")) { uiapp.OpenAndActivateDocument(path); return Ok(new() { ["mode"] = "open" }); }
                return LinkRvt(uiapp, path);
            }

            var doc = ActiveDoc(uiapp);
            var view = uiapp.ActiveUIDocument.ActiveView;
            if (view == null || view is ViewSchedule || view is ViewSheet) view = Get3DView(doc);

            using var t = new Transaction(doc, $"BoxBim: importar {format.ToUpperInvariant()}");
            t.Start();
            ElementId id = ElementId.InvalidElementId;
            switch (format)
            {
                case "dwg":
                case "dxf":
                    {
                        var o = new DWGImportOptions { Placement = ImportPlacement.Origin, ThisViewOnly = false, Unit = ImportUnit.Default };
                        if (link) doc.Link(path, o, view, out id); else doc.Import(path, o, view, out id);
                        break;
                    }
                case "obj":
                    id = link ? doc.Link(path, new OBJImportOptions(), view) : doc.Import(path, new OBJImportOptions(), view);
                    break;
                case "stl":
                    id = link ? doc.Link(path, new STLImportOptions(), view) : doc.Import(path, new STLImportOptions(), view);
                    break;
                case "skp":
                    id = link ? doc.Link(path, new SKPImportOptions(), view) : doc.Import(path, new SKPImportOptions(), view);
                    break;
                case "sat":
                    id = link ? doc.Link(path, new SATImportOptions(), view) : doc.Import(path, new SATImportOptions(), view);
                    break;
                case "step":
                case "stp":
                    id = link ? doc.Link(path, new STEPImportOptions(), view) : doc.Import(path, new STEPImportOptions(), view);
                    break;
                case "3dm":
                    id = link ? doc.Link(path, new ImportOptions3DM(), view) : doc.Import(path, new ImportOptions3DM(), view);
                    break;
                default:
                    t.RollBack();
                    throw new ArgumentException($"O Revit não importa '{format}' diretamente. Converta para IFC, OBJ ou DWG no BoxBim.");
            }
            t.Commit();
            return Ok(new() { ["elementId"] = id?.Value ?? -1, ["mode"] = link ? "link" : "import", ["view"] = view.Name });
        }

        private static object Open(UIApplication uiapp, JsonObject req)
        {
            var path = Str(req, "path") ?? throw new ArgumentException("Informe 'path'.");
            if (Path.GetExtension(path).Equals(".ifc", StringComparison.OrdinalIgnoreCase))
                path = ConvertIfc(uiapp, path, Str(req, "rvtPath"));
            uiapp.OpenAndActivateDocument(path);
            return Ok(new() { ["path"] = path });
        }

        private static object IfcToRvt(UIApplication uiapp, JsonObject req)
        {
            var ifc = Str(req, "ifcPath") ?? throw new ArgumentException("Informe 'ifcPath'.");
            var rvt = ConvertIfc(uiapp, ifc, Str(req, "rvtPath"));
            if (Bool(req, "open")) uiapp.OpenAndActivateDocument(rvt);
            return Ok(new() { ["rvt"] = rvt });
        }

        private static string ConvertIfc(UIApplication uiapp, string ifcPath, string rvtPath)
        {
            if (!File.Exists(ifcPath)) throw new FileNotFoundException("IFC não encontrado", ifcPath);
            rvtPath ??= Path.ChangeExtension(ifcPath, ".rvt");
            var doc = uiapp.Application.OpenIFCDocument(ifcPath)
                ?? throw new InvalidOperationException("O Revit não conseguiu abrir o IFC.");
            try
            {
                doc.SaveAs(rvtPath, new SaveAsOptions { OverwriteExistingFile = true });
            }
            finally
            {
                doc.Close(false);
            }
            return rvtPath;
        }

        private static object LinkRvt(UIApplication uiapp, string rvtPath)
        {
            var doc = ActiveDoc(uiapp);
            using var t = new Transaction(doc, "BoxBim: vincular modelo");
            t.Start();
            var mp = ModelPathUtils.ConvertUserVisiblePathToModelPath(rvtPath);
            var result = RevitLinkType.Create(doc, mp, new RevitLinkOptions(false));
            var inst = RevitLinkInstance.Create(doc, result.ElementId);
            t.Commit();
            return Ok(new() { ["mode"] = "link", ["rvt"] = rvtPath, ["linkInstanceId"] = inst.Id.Value });
        }

        private static Dictionary<string, object> Ok(Dictionary<string, object> extra)
        {
            extra["ok"] = true;
            return extra;
        }

        private static string SafeName(string s) =>
            string.Concat(s.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
    }
}
