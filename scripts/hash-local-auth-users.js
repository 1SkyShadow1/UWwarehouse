const crypto = require('crypto');

const input = JSON.parse(process.env.UW_LOCAL_AUTH_INPUT || '{}');
const brianPassword = String(input.brian || '');
const evansPassword = String(input.evans || '');
if (brianPassword.length < 12 || evansPassword.length < 12) {
  console.error('Both existing passphrases must be at least 12 characters.');
  process.exit(1);
}

const hash = password => {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$16384$8$1$${salt}$${derived}`;
};

process.stdout.write(JSON.stringify({
  brian: { name: 'Brian', role: 'Owner', passwordHash: hash(brianPassword) },
  evans: { name: 'Evans', role: 'Manager', passwordHash: hash(evansPassword) },
}));
