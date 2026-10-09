import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AVATAR_COLLISION_PROFILE } from '../../../packages/core/src/avatarCapsules.generated';
import { validateAvatarCollisionSource } from './avatarCollisionSource';

const modelBytes = () => new Uint8Array(readFileSync(new URL('../public/models/neutral-quaternius-v1.glb', import.meta.url))).buffer;
const rigBytes = () => new Uint8Array(readFileSync(new URL('../public/models/neutral-quaternius-v1.json', import.meta.url))).buffer;

describe('model-specific collision source binding', () => {
  it('accepts the actual published model and rig paired with their fitted profile', async () => {
    await expect(validateAvatarCollisionSource(modelBytes(), rigBytes(), AVATAR_COLLISION_PROFILE)).resolves.toBeUndefined();
  });
  it('rejects a replacement mesh that still uses the old model collision dimensions', async () => {
    const model = modelBytes(); new Uint8Array(model)[model.byteLength - 1] ^= 1;
    await expect(validateAvatarCollisionSource(model, rigBytes(), AVATAR_COLLISION_PROFILE)).rejects.toThrow(/重新生成碰撞体/);
  });
  it('rejects a changed rig mapping even when the model mesh is unchanged', async () => {
    const rig = rigBytes(); new Uint8Array(rig)[rig.byteLength - 1] ^= 1;
    await expect(validateAvatarCollisionSource(modelBytes(), rig, AVATAR_COLLISION_PROFILE)).rejects.toThrow(/配置不匹配/);
  });
});
