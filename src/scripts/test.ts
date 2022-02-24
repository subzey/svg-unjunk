import { promises as fs } from 'fs';
import { DOMParser, XMLSerializer } from 'xmldom';

// We reference the file that wasn't yet built.
// Any ideas on how it can be achieved without ts-ignore?

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { SvgUnjunk } from '../../dist/index.js';

interface TestCase {
	filename: string;
	input: string;
	expected?: string;
	expectedLossless?: string;
}

interface TestCaseConfig {
	skipLossless: boolean;
}

interface ThrowsTestCase {
	filename: string;
	input: string;
}

const RE_TEST_INPUT = /\.input\.svg$/;
const RE_THROWS = /\.throws.txt$/;

async function * loadTestCases(): AsyncIterableIterator<TestCase> {
	const allFiles = await fs.readdir('test', { withFileTypes: true });
	const filenames = (allFiles
		.filter(dirent => dirent.isFile() && RE_TEST_INPUT.test(dirent.name))
		.map(dirent => dirent.name)
		.sort()
	);
	const undefinedIfEnoent = (error: Error & { code?: string }): undefined => {
		if (error.code === 'ENOENT') {
			return undefined;
		}
		// Rethrow
		throw error;
	}

	for (const filename of filenames) {
		const [input, expected, expectedLossless] = await Promise.all([
			fs.readFile(`test/${filename}`, 'utf-8'),
			fs.readFile(`test/${filename.replace(RE_TEST_INPUT, '.expected.svg')}`, 'utf-8').catch(undefinedIfEnoent),
			fs.readFile(`test/${filename.replace(RE_TEST_INPUT, '.expected-lossless.svg')}`, 'utf-8').catch(undefinedIfEnoent),
		]);
		yield { filename, input, expected, expectedLossless };
	}
}

async function * loadThrows(): AsyncIterableIterator<ThrowsTestCase> {
	const allFiles = await fs.readdir('test', { withFileTypes: true });
	const filenames = (allFiles
		.filter(dirent => dirent.isFile() && RE_THROWS.test(dirent.name))
		.map(dirent => dirent.name)
		.sort()
	);
	for (const filename of filenames) {
		yield { filename, input: await fs.readFile(`test/${filename}`, 'utf-8') };
	}
}

function stripIndentation(xml: string): string {
	const doc = new DOMParser().parseFromString(xml, 'image/svg+sml');
	removeWs(doc);
	return new XMLSerializer().serializeToString(doc);
}

function removeWs(parentNode: Element | Document): void {
	for (const child of Array.from(parentNode.childNodes)) {
		if (child.nodeType === 1 /* Node.ELEMENT_NODE */) {
			removeWs(child as Element);
			continue;
		}
		if (child.nodeType === 3 /* Node.TEXT_NODE */ && child.textContent) {
			child.textContent = child.textContent.trim().replace(/\s+/g, ' ');
		}
	}
}

function _isProcessingInstruction(node: Node): node is ProcessingInstruction {
	return node.nodeType === 7 /* Node.PROCESSING_INSTRUCTION_NODE */;
}

function getConfigFomTest(svgCode: string): TestCaseConfig {
	const res: TestCaseConfig = {
		skipLossless: false,
	};
	const inputDoc = new DOMParser().parseFromString(svgCode, 'image/svg+xml');
	for (const child of Array.from(inputDoc.childNodes)) {
		if (!_isProcessingInstruction(child)) {
			continue;
		}
		if (child.target !== 'config') {
			continue;
		}
		const keywords = new Set(child.data.split(/\s+/));
		if (keywords.has('skip-lossless')) {
			res.skipLossless = true;
		}
	}
	return res;
}

async function runTestCase(svgUnjunk: SvgUnjunk, testCase: TestCase): Promise<void> {
	const testCaseConfig = getConfigFomTest(testCase.input);
	for (const options of [{}, {lossless: true}]) {
		const input = testCase.input;
		const banner = `${testCase.filename}, ${JSON.stringify(options)}`;
		let expected = (options.lossless && testCase.expectedLossless !== undefined) ? testCase.expectedLossless : testCase.expected;
		if (expected) {
			expected = stripIndentation(expected)
		}
		const output = await svgUnjunk.process(input, options);

		new DOMParser().parseFromString(output, 'image/svg+xml'); // Let it crash

		let shouldSkip = false;
		if (options.lossless && testCaseConfig.skipLossless) {
			shouldSkip = true;
		}
		if (shouldSkip) {
			process.stdout.write('\u001b[34m' + `SKIPPED ${banner}` + '\u001b[m\n');
			continue;
		}

		if (expected === undefined) {
			process.stdout.write(
				'\u001b[33m' + `WARN ${banner}: Nothing to compare with` + '\u001b[m\n' +
				'\u001b[33m' + `Anyways, here's your result:` + '\u001b[m\n' + output + '\n'
			);
			continue;
		}

		if (output === expected) {
			process.stdout.write('\u001b[32m' + `OK ${banner}` + '\u001b[m\n');
			continue;
		}

		process.exitCode = 1;
		process.stdout.write(
			'\u001b[31m' + `FAILED! ${banner}` + '\u001b[m\n' +
			`ACTUAL:\n${output}\n` +
			`EXPECTED:\n${expected}\n`
		);
	}
}

async function main() {
	const runOnly = new Set(process.argv.slice(2));
	const svgUnjunk = new SvgUnjunk();

	process.chdir(__dirname + '/../..');

	for await (const throwsCase of loadThrows()) {
		if (runOnly.size > 0 && !runOnly.has(throwsCase.filename.replace(RE_THROWS, ''))) {
			continue;
		}

		const banner = `${throwsCase.filename}`;
		try {
			await svgUnjunk.process(throwsCase.input);
			process.exitCode = 1;
			process.stdout.write('\u001b[31m' + `FAILED! ${banner} should throw an error` + '\u001b[m\n');
		} catch {
			process.stdout.write('\u001b[32m' + `OK ${banner}` + '\u001b[m\n');
			continue;
		}
	}

	const testCases: TestCase[] = [];
	for await (const testCase of loadTestCases()) {
		if (runOnly.size > 0 && !runOnly.has(testCase.filename.replace(RE_TEST_INPUT, ''))) {
			continue;
		}
		testCases.push(testCase);
	}

	await Promise.all(testCases.map(testCase => runTestCase(svgUnjunk, testCase)));

	svgUnjunk.destroy();

	console.log('Testing double .destroy()...')
	svgUnjunk.destroy();

	console.log('Tesing sync .destroy()...');
	new SvgUnjunk().destroy();
	setTimeout(() => {
		console.error('Node.js process haven\'t finished in reasonable time');
		process.exit(1);
	}, 5000).unref();
}

main().catch(reason => {
	console.error(reason);
	process.exit(1);
});
