import assert from 'node:assert/strict';
import test from 'node:test';
import { matchDeployKeys, normalizePublicKey, publicKeyFingerprint } from '../src/github/deploy-key-match';

// Generated with ssh-keygen -t ed25519.
const KEY_A = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIImd5iHecYxUFM4/I2yvzFTZmZUbq/g6mwEwhMeXcEOq';
const KEY_B = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILeHgYWqcZov+XbekWa4/aY50TPfs0DCdUH7N76+wlwz';
const KEY_C = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBe3i4SAOuJ6W/BQHv+Vw6BltYgRlRMTPjzyNEiLwE3N';

test('normalizes a key the way GitHub stores it, comment dropped', () => {
  assert.equal(normalizePublicKey(`${KEY_A} tarmac-deploy\n`), KEY_A);
  assert.equal(normalizePublicKey('not a key'), null);
  assert.equal(normalizePublicKey('ssh-ed25519 abc def; rm -rf /'), null);
  assert.equal(normalizePublicKey(null), null);
  // Base64 that isn't a key blob of the announced type.
  assert.equal(normalizePublicKey('ssh-ed25519 QUJDREVGR0g='), null);
});

test('fingerprints like ssh-keygen -l', () => {
  assert.equal(publicKeyFingerprint(KEY_A), 'SHA256:B0DAAjhUzxtk1PW2Wv20zL/Q3IX6cVepwKKWeDCSsUY');
  assert.notEqual(publicKeyFingerprint(KEY_A), publicKeyFingerprint(KEY_B));
});

test('links nodes to the GitHub keys they hold, lists the rest', () => {
  const result = matchDeployKeys(
    [
      { id: 'n1', deployKeyPublic: `${KEY_A} tarmac-deploy`, githubDeployKeyId: null },
      { id: 'n2', deployKeyPublic: KEY_B, githubDeployKeyId: null },
      { id: 'n3', deployKeyPublic: null, githubDeployKeyId: null },
    ],
    [
      { id: 11, key: KEY_A, title: 'tarmac-node-1', read_only: true },
      { id: 12, key: KEY_C, title: 'laptop', read_only: false },
    ],
  );
  assert.deepEqual([...result.linked], [['n1', '11']]);
  assert.deepEqual(result.missing, ['n2']);
  assert.deepEqual(result.orphans.map((key) => key.id), [12]);
});
