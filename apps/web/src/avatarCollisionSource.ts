/** A replacement mesh must ship its own newly fitted collision configuration. */
export interface AvatarCollisionSourceFingerprint {
  readonly sourceGlbSha256: string;
  readonly sourceRigSha256: string;
}

export async function validateAvatarCollisionSource(model: ArrayBuffer, rig: ArrayBuffer, profile: AvatarCollisionSourceFingerprint): Promise<void> {
  const hash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const [modelHash, rigHash] = await Promise.all([hash(model), hash(rig)]);
  if (modelHash !== profile.sourceGlbSha256 || rigHash !== profile.sourceRigSha256) {
    throw new Error('人物模型与碰撞配置不匹配，请为此模型重新生成碰撞体。');
  }
}
