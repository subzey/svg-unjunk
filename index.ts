import { readFile, writeFile } from 'fs/promises';
import { pathToFileURL } from 'url';
import * as puppeteer from 'puppeteer';

async function doStuff(impl: (input: string) => Promise<string>): Promise<void> {
	for (const arg of process.argv.slice(2)) {
		const input = await readFile(arg, 'utf-8');
		const output = await impl(input);
		const patched = output.replace(/( xmlns="http:\/\/www\.w3\.org\/2000\/svg")([^>]*)>/, '$2$1>');

		const sizeBefore = Buffer.byteLength(input);
		const sizeAfter = Buffer.byteLength(patched);

		if (sizeAfter < sizeBefore) {
			console.log(`${arg} ${sizeBefore} -> ${sizeAfter}`);
			await writeFile(arg, patched);
		}
	}
}

async function main() {
	const pageUrl = pathToFileURL(__dirname + '/index.html');
	const browser = await puppeteer.launch({ headless: false });
	const page = await browser.newPage();
	const res = await page.goto(pageUrl.href, { waitUntil: 'load' });
	if (!res || !res.ok) {
		throw new Error(`Could not navigate to ${pageUrl.href}`);
	}
	const impl = (input: string): Promise<string> => page.evaluate(
		//@ts-ignore
		svgCode => unjunk(svgCode),
		input
	) as Promise<string>;
	await doStuff(impl);
	browser.close();
}

main().catch(e => {
	console.error(e instanceof Error ? e.stack : String(e));
	process.exit(1);
});