// Packages main.cjs with the web build (../build, from `npm run build` at the
// repo root) as resources/web. The version follows the root package.json.
const { version } = require('../package.json');

const icon = '../static/kurumi-icon.png';

/** @type {import('electron-builder').Configuration} */
module.exports = {
	appId: 'io.raskell.kurumi',
	productName: 'Kurumi',
	copyright: 'Copyright © Raffael Schneider',
	extraMetadata: { version },
	directories: { output: 'dist' },
	files: ['main.cjs', 'package.json'],
	extraResources: [{ from: '../build', to: 'web', filter: ['**/*', '!CNAME'] }],
	artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
	publish: null,
	mac: {
		icon,
		category: 'public.app-category.productivity',
		target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
		// Ad-hoc signature until there is a Developer ID: Apple Silicon refuses
		// to run an unsigned app ("damaged"); ad-hoc only needs "Open Anyway".
		identity: '-',
		// Only needed for notarization, and with an ad-hoc signature it can
		// stop the app from loading its own frameworks.
		hardenedRuntime: false,
		extendInfo: {
			NSMicrophoneUsageDescription: 'Kurumi records voice memos and meetings.',
			NSCameraUsageDescription: 'Kurumi can take photos for your notes.'
		}
	},
	win: {
		icon,
		target: [{ target: 'nsis', arch: ['x64'] }]
	},
	nsis: {
		oneClick: false,
		perMachine: false,
		allowToChangeInstallationDirectory: true
	},
	linux: {
		icon,
		category: 'Office',
		target: ['AppImage']
	}
};
