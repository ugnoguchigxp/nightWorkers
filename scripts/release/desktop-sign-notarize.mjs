import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const appPath = process.env.NIGHTWORKERS_DESKTOP_APP_PATH;
const identity = process.env.APPLE_DEVELOPER_ID_APPLICATION;
const notarizationProfile = process.env.APPLE_NOTARYTOOL_PROFILE;

if (!appPath || !identity || !notarizationProfile) {
  throw new Error(
    'Set NIGHTWORKERS_DESKTOP_APP_PATH, APPLE_DEVELOPER_ID_APPLICATION, and APPLE_NOTARYTOOL_PROFILE before signing.'
  );
}

if (!fs.existsSync(appPath)) {
  throw new Error(`App path does not exist: ${appPath}`);
}

execFileSync('codesign', ['--force', '--deep', '--options', 'runtime', '--sign', identity, appPath], {
  stdio: 'inherit',
});
execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
execFileSync('xcrun', ['notarytool', 'submit', appPath, '--keychain-profile', notarizationProfile, '--wait'], {
  stdio: 'inherit',
});
execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
execFileSync('xcrun', ['stapler', 'validate', appPath], { stdio: 'inherit' });
execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose', appPath], { stdio: 'inherit' });

console.log('Signing, notarization, stapling, and Gatekeeper verification passed.');
