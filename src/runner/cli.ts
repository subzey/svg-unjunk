#!/usr/bin/env node
import * as fs from 'fs';
import * as yargs from 'yargs';
import { SvgUnjunk, Options as SvgUnjunkOptions } from './index.js';

interface CliArgs {
	filenames: string[];
	lossless: boolean;
	parallel: number;
	scale: number;
	debug: boolean;
}

function getArgs(): CliArgs {
	const argv = (yargs
		.usage('$0 [OPTIONS] FILE [FILE...]')
		.options({
			_: { type: 'array', string: true },
			lossless: { type: 'boolean', default: false, description: 'Lossless transformations (default is near-lossless)'},
			parallel: {type: 'number', description: 'Max parallel processings (default is # of CPUs)'},
			scale: { type: 'number', default: 2, description: 'How to scale SVG when rasterizing'},
			debug: { type: 'boolean', default: false, description: 'Set to show puppeteer browser window' },
		})
		.argv
	);
	return {
		filenames: argv._,
		lossless: argv.lossless,
		scale: argv.scale,
		parallel: Math.max(argv.parallel || 0, 0),
		debug: argv.debug,
	};
}

async function bulkOverwrite(svgUnjunk: SvgUnjunk, filenames: string[], options: SvgUnjunkOptions): Promise<void> {
	async function runForFile(filename: string) {
		const input: string | undefined = await fs.promises.readFile(filename, 'utf-8').catch(() => undefined);
		if (input === undefined) {
			console.error(`Could not read file ${filename}`);
			process.exitCode = 1;
			return;
		}
		let output: string;
		try {
			output = await svgUnjunk.process(input, options);
		} catch (e) {
			console.error(`Could not process ${filename}:`);
			console.error(e);
			return;
		}
		const sizeBefore = Buffer.byteLength(input);
		const sizeAfter = Buffer.byteLength(output);
		if (sizeAfter >= sizeBefore) {
			return;
		}
		await fs.promises.writeFile(filename, output);
		console.log(`${filename}: ${sizeBefore} -> ${sizeAfter}`);
	}

	await Promise.all(filenames.map(runForFile));
}

async function main() {
	const args = getArgs();
	if (args.filenames.length === 0) {
		if (process.argv.length < 3 && process.stderr.isTTY) {
			// Do not show if -- is used
			process.stderr.write('No files to process. Run --help for help.\n');
		}
		return;
	}
	const svgUnjunk = new SvgUnjunk({ headless: !args.debug, parallel: args.parallel });
	await bulkOverwrite(svgUnjunk, args.filenames, args);
	svgUnjunk.destroy();
}

main().catch((reason: unknown) => {
	console.error(reason);
	process.exit(2);
});
