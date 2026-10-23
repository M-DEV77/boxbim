// Encaixe do gizmo de mover/girar aplicado sobre o DESLOCAMENTO (como no Revit): arrastar 1,23 m com passo
// 0,05 m resulta em 1,25 m, qualquer que seja a posição inicial. (O encaixe nativo do TransformControls
// arredonda a posição absoluta, o que gera deslocamentos "quebrados".)
import * as THREE from 'three';

const DEG = Math.PI / 180;

/** Ajusta o pivô em relação ao início do arraste. stepM em metros, stepDeg em graus; 0/null = livre. */
export function snapPivot(pivot, startPos, startQuat, stepM, stepDeg) {
  if (stepM) {
    const d = pivot.position.clone().sub(startPos);
    d.set(Math.round(d.x / stepM) * stepM, Math.round(d.y / stepM) * stepM, Math.round(d.z / stepM) * stepM);
    pivot.position.copy(startPos).add(d);
  }
  if (stepDeg) {
    const dq = pivot.quaternion.clone().multiply(startQuat.clone().invert());
    const w = Math.min(1, Math.abs(dq.w));
    const angle = 2 * Math.acos(w);
    if (angle > 1e-9) {
      const axis = new THREE.Vector3(dq.x, dq.y, dq.z).multiplyScalar(Math.sign(dq.w) || 1).normalize();
      const snapped = Math.round(angle / DEG / stepDeg) * stepDeg * DEG;
      pivot.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(axis, snapped).multiply(startQuat));
    }
  }
  pivot.updateMatrixWorld(true);
}
