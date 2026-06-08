const fs = require('fs');

for (const file of ['tsconfig.build.tsbuildinfo']) {
  try {
    fs.unlinkSync(file);
  } catch {
    // File may not exist — safe to ignore.
  }
}
