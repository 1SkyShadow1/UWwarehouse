const crypto = require('crypto');

const [brianPassword, evansPassword] = process.argv.slice(2);
if (!brianPassword || !evansPassword || brianPassword.length < 12 || evansPassword.length < 12) {
  console.error('Usage: node scripts/generate-auth-config.js "Brian passphrase" "Evans passphrase"');
  console.error('Passphrases must be at least 12 characters and are never written to disk.');
  process.exit(1);
}

const hash = password => new Promise((resolve, reject) => {
  const salt = crypto.randomBytes(16).toString('base64url');
  crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) => {
    if (error) return reject(error);
    resolve(`scrypt$16384$8$1$${salt}$${derived.toString('hex')}`);
  });
});

Promise.all([hash(brianPassword), hash(evansPassword)])
  .then(([brianHash, evansHash]) => {
    console.log(JSON.stringify({
      brian: { name: 'Brian', role: 'Owner', passwordHash: brianHash },
      evans: { name: 'Evans', role: 'Manager', passwordHash: evansHash },
    }));
  })
  .catch(error => {
    console.error(error.message);
    process.exit(1);
  });
