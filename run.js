const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const appRoot = path.resolve(__dirname, 'app');
  process.chdir(appRoot);

  const entryUrl = pathToFileURL(path.join(appRoot, 'src', 'cli', 'run.js'));
  await import(entryUrl.href);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
