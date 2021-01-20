import { promises as fs } from 'fs';

async function main() {
	process.chdir(__dirname + '/../..');
	const pkg = JSON.parse(await fs.readFile('dist/package.json', 'utf-8'));
	delete pkg.private;
	await fs.writeFile('dist/package.json', JSON.stringify(pkg, null, 2));
}

main().catch(reason => {
	console.error(reason);
	process.exit(1);
});
