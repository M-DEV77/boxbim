# Script do BoxBim para o Unreal Engine 5 (copiado para Content/Python/init_unreal.py; o editor roda sozinho ao abrir).
# Quando o BoxBim manda um modelo novo (Import/boxbim.json mais novo que Import/.importado) — ao abrir o editor ou
# com ele já aberto —, monta o nível
# /Game/BoxBim/BoxBim: importa a cena glTF (malhas, materiais PBR, câmera e sol) pelo Interchange, cria céu com
# atmosfera, nuvens volumétricas, luz do céu, neblina e um volume de pós-processamento, e liga o DLSS se o plugin
# da NVIDIA estiver presente.
import json
import os

import unreal

PROJ = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
IMP = os.path.join(PROJ, 'Import')
META = os.path.join(IMP, 'boxbim.json')
GLB = os.path.join(IMP, 'modelo.glb')
DONE = os.path.join(IMP, '.importado')
LEVEL = '/Game/BoxBim/BoxBim'
CONTENT = '/Game/BoxBim/Modelo'
TAG = 'BoxBim'


def log(*a):
    unreal.log('[BoxBim] ' + ' '.join(str(x) for x in a))


def notify(msg):
    unreal.EditorDialog.show_message('BoxBim', msg, unreal.AppMsgType.OK)


def pending():
    return os.path.exists(META) and os.path.exists(GLB) and (
        not os.path.exists(DONE) or os.path.getmtime(META) > os.path.getmtime(DONE))


def spawn(cls, label, loc=(0, 0, 0), rot=(0, 0, 0)):
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(cls, unreal.Vector(*loc), unreal.Rotator(*rot))
    actor.set_actor_label(label)
    actor.tags = [TAG]
    return actor


def clear_previous():
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    old = [a for a in eas.get_all_level_actors() if TAG in [str(t) for t in a.tags]]
    for a in old:
        eas.destroy_actor(a)
    log('removidos', len(old), 'atores da importação anterior')


def import_scene():
    """Importa malhas, materiais, câmera e luz já posicionados no nível (Interchange). Devolve os atores novos."""
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    before = set(a.get_path_name() for a in eas.get_all_level_actors())
    mgr = unreal.InterchangeManager.get_interchange_manager_scripted()
    src = unreal.InterchangeManager.create_source_data(GLB)
    params = unreal.ImportAssetParameters()
    params.is_automated = True
    params.replace_existing = True
    ok = mgr.import_scene(CONTENT, src, params)
    new = [a for a in eas.get_all_level_actors() if a.get_path_name() not in before]
    for a in new:
        a.tags = [TAG]
    log('import_scene', 'ok' if ok else 'falhou', '-', len(new), 'atores')
    return new


def environment(meta, imported):
    s = meta.get('settings', {})
    ceu = s.get('ceu', 'dia')
    # sol: a luz direcional que veio do glTF (orientação do BoxBim); sem ela, cria uma
    suns = [a for a in imported if isinstance(a, unreal.DirectionalLight)]
    sun = suns[0] if suns else spawn(unreal.DirectionalLight, 'Sol', rot=(0, -float(s.get('altura', 40)), float(s.get('azimute', 135))))
    sun.set_actor_label('Sol (BoxBim)')
    comp = sun.get_component_by_class(unreal.DirectionalLightComponent)
    comp.set_editor_property('intensity', 6.0 if ceu == 'nublado' else 10.0)  # lux, com exposição manual abaixo
    comp.set_editor_property('atmosphere_sun_light', True)
    comp.set_editor_property('cast_shadows', True)
    if ceu == 'entardecer':
        comp.set_editor_property('light_color', unreal.Color(255, 190, 140, 255))
    comp.set_mobility(unreal.ComponentMobility.MOVABLE)

    spawn(unreal.SkyAtmosphere, 'Atmosfera')
    sky = spawn(unreal.SkyLight, 'Luz do céu')
    sky_c = sky.get_component_by_class(unreal.SkyLightComponent)
    sky_c.set_editor_property('real_time_capture', True)
    sky_c.set_mobility(unreal.ComponentMobility.MOVABLE)
    clouds = spawn(unreal.VolumetricCloud, 'Nuvens', loc=(0, 0, 0))
    if ceu == 'dia':
        clouds.set_actor_hidden_in_game(False)
    spawn(unreal.ExponentialHeightFog, 'Neblina')

    ppv = spawn(unreal.PostProcessVolume, 'Pós-processamento')
    ppv.set_editor_property('unbound', True)
    st = ppv.get_editor_property('settings')
    st.set_editor_property('override_auto_exposure_method', True)
    st.set_editor_property('auto_exposure_method', unreal.AutoExposureMethod.AEM_MANUAL)
    st.set_editor_property('override_auto_exposure_bias', True)
    # exposição manual ~ EV 10 (dia); o controle "Exposição" do BoxBim soma em EV
    import math
    st.set_editor_property('auto_exposure_bias', 10.0 + math.log2(max(0.05, float(s.get('exposicao', 1)))))
    st.set_editor_property('override_auto_exposure_apply_physical_camera_exposure', True)
    st.set_editor_property('auto_exposure_apply_physical_camera_exposure', False)
    ppv.set_editor_property('settings', st)

    # câmera: a que veio do glTF (vista do BoxBim)
    cams = [a for a in imported if isinstance(a, unreal.CameraActor)]
    if cams:
        cams[0].set_actor_label('Câmera (BoxBim)')
        unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).set_level_viewport_camera_info(
            cams[0].get_actor_location(), cams[0].get_actor_rotation())


def enable_dlss(meta):
    if not meta.get('dlss'):
        log('plugin DLSS não instalado: usando TSR. Instale "NVIDIA DLSS" (Fab) para Super Resolution / Ray Reconstruction / Frame Generation.')
        return
    world = unreal.EditorLevelLibrary.get_editor_world()
    for cmd in ('r.NGX.Enable 1', 'r.NGX.DLSS.Enable 1', 'r.NGX.DLSS.DenoiserMode 1', 'r.Streamline.DLSSG.Enable 1'):
        unreal.SystemLibrary.execute_console_command(world, cmd)
    log('DLSS ligado (Super Resolution + Ray Reconstruction; Frame Generation se suportado)')


def build():
    with open(META, encoding='utf-8') as f:
        meta = json.load(f)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if unreal.EditorAssetLibrary.does_asset_exist(LEVEL):
        les.load_level(LEVEL)
        clear_previous()
    else:
        les.new_level(LEVEL)
    imported = import_scene()
    environment(meta, imported)
    les.save_current_level()
    with open(DONE, 'w', encoding='utf-8') as f:
        f.write(meta.get('exported', ''))
    enable_dlss(meta)
    notify('Modelo importado do BoxBim em /Game/BoxBim/BoxBim.\n'
           + ('DLSS ligado.' if meta.get('dlss') else 'Plugin NVIDIA DLSS não encontrado: usando TSR.'))


_acc = 0.0


def _tick(dt):
    # com o editor aberto, confere a cada 2 s se o BoxBim mandou um modelo novo (abrir de novo pelo BoxBim
    # só atualiza a pasta Import; a reimportação acontece aqui, sem fechar o editor)
    global _acc
    _acc += dt
    if _acc < 2.0:
        return
    _acc = 0.0
    if unreal.EditorLevelLibrary.get_editor_world() is None or not pending():
        return
    try:
        build()
    except Exception as e:  # noqa: BLE001 — mostra qualquer falha ao usuário
        unreal.log_error('[BoxBim] falha ao importar: %s' % e)
        with open(DONE, 'w', encoding='utf-8') as f:
            f.write('erro')  # não repete a mesma falha a cada 2 s
        notify('Falha ao importar o modelo: %s' % e)


unreal.register_slate_post_tick_callback(_tick)
