const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const passwords = {
  brian: 'Original-Brian-Smoke-Phrase-2026',
  evans: 'Original-Evans-Smoke-Phrase-2026',
};
const result = spawnSync(process.execPath, [path.join(__dirname, 'hash-local-auth-users.js')], {
  env: { ...process.env, UW_LOCAL_AUTH_INPUT: JSON.stringify(passwords) },
  encoding: 'utf8',
});
assert.equal(result.status, 0, result.stderr || 'Local passphrase hashing failed.');
const users = JSON.parse(result.stdout);

for (const [key, password] of Object.entries(passwords)) {
  const user = users[key];
  assert.equal(user.name.toLowerCase(), key);
  assert.ok(user.passwordHash.startsWith('scrypt$16384$8$1$'));
  const [, n, r, p, salt, expected] = user.passwordHash.split('$');
  const derived = crypto.scryptSync(password, salt, 64, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  }).toString('hex');
  assert.equal(derived, expected, `${key} passphrase did not verify against its stored hash.`);
}

const dotenvValue = dotenv.parse(`UW_AUTH_USERS_JSON='${JSON.stringify(users)}'`);
assert.deepEqual(JSON.parse(dotenvValue.UW_AUTH_USERS_JSON), users, 'Quoted auth JSON did not round-trip through dotenv.');

console.log('Local passphrase hashes verify successfully.');
