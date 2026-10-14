import { BufferAttribute, CapsuleGeometry, Color, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmpColor = new Color();

/** Pinta a geometria inteira com uma cor (atributo `color`, para materiais com vertexColors). */
export function paint<T extends BufferGeometry>(geometry: T, hex: number): T {
  tmpColor.setHex(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** Junta geometrias com os mesmos atributos num único draw call. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('mergeGeometries falhou: atributos incompatíveis');
  for (const p of parts) p.dispose();
  return merged;
}

/** Cápsula do osso: centros das tampas em y = 0 e y = length (as tampas cobrem as juntas). */
export function boneCapsule(radius: number, length: number, radialSegments: number): BufferGeometry {
  return new CapsuleGeometry(radius, length, Math.max(2, radialSegments / 2), radialSegments).translate(0, length / 2, 0);
}

const placeMatrix = new Matrix4();
const placeQuat = new Quaternion();
const placeScale = new Vector3(1, 1, 1);
const UP = new Vector3(0, 1, 0);

/** Aplica posição + rotação em Y (yaw) direto nos vértices. */
export function placeYaw<T extends BufferGeometry>(geometry: T, position: Vector3, yaw: number): T {
  placeQuat.setFromAxisAngle(UP, yaw);
  return geometry.applyMatrix4(placeMatrix.compose(position, placeQuat, placeScale));
}
