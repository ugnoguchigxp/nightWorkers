import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const appPath = process.env.NIGHTWORKERS_DESKTOP_APP_PATH;
const identity = process.env.APPLE_DEVELOPER_ID_APPLICATION;

if (!appPath || !identity) {
  throw new Error(
    'Set NIGHTWORKERS_DESKTOP_APP_PATH and APPLE_DEVELOPER_ID_APPLICATION before signing. Notarization also requires Apple notary credentials configured for xcrun notarytool.'
  );
}

if (!fs.existsSync(appPath)) {
  throw new Error(`App path does not exist: ${appPath}`);
}

execFileSync('codesign', ['--force', '--deep', '--options', 'runtime', '--sign', identity, appPath], {
  stdio: 'inherit',
});
execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose', appPath], { stdio: 'inherit' });

console.log('Signing verification passed. Submit the DMG/app for notarization with xcrun notarytool, then staple and validate.');
