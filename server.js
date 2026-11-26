const path = require('path');
const express = require('express');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const BLOCKED_FILES = new Set([
  '/server.js',
  '/package.json',
  '/package-lock.json',
  '/metadata.json',
]);

app.use((req, res, next) => {
  if (BLOCKED_FILES.has(req.path) || req.path.startsWith('/node_modules')) {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(__dirname, { dotfiles: 'ignore' }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
