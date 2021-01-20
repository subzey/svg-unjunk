import { promises as fs } from 'fs';

async function main() {
	process.chdir(__dirname + '/../..');
	await fs.mkdir('dist').catch(reason => {
		if (reason.code !== 'EEXIST') {
			throw reason;
		}
	});

	await Promise.all([
		fs.copyFile('build/runner/index.js', 'dist/index.js'),
		fs.copyFile('build/runner/index.d.ts', 'dist/index.d.ts'),
		fs.copyFile('build/runner/cli.js', 'dist/cli.js'),
		fs.copyFile('src/page/favicon.svg', 'dist/favicon.svg'),
		fs.copyFile('src/README.md', 'dist/README.md'),
	]);

	await fs.chmod('dist/cli.js', 0o775);

	const [template, debugTemplate, pageScript] = await Promise.all([
		fs.readFile('src/page/template.html', 'utf-8'),
		fs.readFile('src/page/debug.html', 'utf-8'),
		fs.readFile('build/page/unjunk.js', 'utf-8')
	]);

	const trimmedScript = (pageScript
		// Remove TypeScript references. It's useless for the inlined script.
		.replace(/\/\/\/\s*<reference\b.*/, '')
		.trim()
	);
	await Promise.all([
		fs.writeFile('build/debug.html', debugTemplate.replace('/* INLINE HERE */', '\n' + trimmedScript+ '\n')),
		fs.writeFile('dist/page.html', template.replace('/* INLINE HERE */', '\n' + trimmedScript + '\n')),
	]);

	const pkg = JSON.parse(await fs.readFile('package.json', 'utf-8'));
	delete pkg.scripts;
	delete pkg.devDependencies;

	for (const field of ['main', 'typings', 'bin']) {
		pkg[field] = pkg[field].replace(/^(\.\/)?dist\//, '');
	}
	await fs.writeFile('dist/package.json', JSON.stringify(pkg, null, 2));
}

main().catch(reason => {
	console.error(reason);
	process.exit(1);
});
