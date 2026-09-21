const crypto = require('crypto');

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Usage: node scripts/generate-auth-hash.js "a-long-password"');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('base64url');
crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) => {
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`scrypt$16384$8$1$${salt}$${derived.toString('hex')}`);
});
