///<reference types="../interface"/>

import { cpus } from 'os';
import { pathToFileURL } from 'url';
import * as puppeteer from 'puppeteer';

export interface ConstructorOptions {
	/** Do not show the browser window while processing. Default is true (do not show) */
	headless?: boolean;
	/** Open up to # tabs for processing. Default is # CPUs */
	parallel?: number;
}

export interface Options {
	/** How to scale the SVG when rasterizing Default is 2 ("retina") */
	scale?: number;
	/**
	 * Should comparison be absolutely lossless. Default is no (near-lossless).
	 * In lossless mode svg-unjunk may leave seemingly useless elements because of
	 * premultiplied alpha quirks and rasterization artifacts.
	 */
	lossless?: boolean;
}

/** Same as the interface but with properties unknown */
type ActuallyUnknown<T> = {[k in keyof T]: unknown} | undefined | null;

class PagePool {
	private readonly _browser: Promise<puppeteer.Browser>;
	private readonly _freePages: puppeteer.Page[] = [];
	private readonly _maxPages: number;
	private readonly _resolutionQueue: ((page: puppeteer.Page) => unknown)[] = [];
	private _poolSize = 0;

	constructor(options?: ConstructorOptions) {
		if (options && Math.floor(options.parallel) > 0) {
			this._maxPages = Math.floor(options.parallel);
		} else {
			this._maxPages = cpus().length;
		}

		this._browser = puppeteer.launch({
			headless: options.headless,
		});
	}

	public alloc(): Promise<puppeteer.Page> {
		if (this._freePages.length > 0) {
			return Promise.resolve(this._freePages.pop());
		}
		const promise = new Promise((resolve: (page: puppeteer.Page) => unknown) => {
			this._resolutionQueue.push(resolve);
		});
		if (this._poolSize < this._maxPages) {
			this._createPage(this._poolSize === 0).then((page: puppeteer.Page) => this.free(page));
			this._poolSize++;
		}
		return promise;
	}

	public free(page: puppeteer.Page): void {
		this._freePages.push(page);
		this._resolveFromPool();
	}

	public destroy(): void {
		(this._browser
			.then((browser: puppeteer.Browser) => {
				browser.close();
			})
			.catch(() => {
				// Do nothing
			})
		);
	}

	private _resolveFromPool(): void {
		const canResolve = Math.min(this._resolutionQueue.length, this._freePages.length);
		if (canResolve === 0) {
			return;
		}
		const pool = this._freePages.splice(0, canResolve);
		const resolvers = this._resolutionQueue.splice(0, canResolve);
		for (let i = 0; i < canResolve; i++) {
			resolvers[i](pool[i]);
		}
	}

	private async _createPage(reuseFirst: boolean): Promise<puppeteer.Page> {
		const pageUrl = pathToFileURL(__dirname + '/page.html');
		const browser = await this._browser;
		let page: puppeteer.Page;
		if (reuseFirst) {
			const pages = await browser.pages();
			page = pages[0];
		}
		if (!page) {
			page = await browser.newPage();
		}
		const res = await page.goto(pageUrl.href, { waitUntil: 'load' });
		if (!res || !res.ok) {
			throw new Error(`Could not navigate to ${pageUrl}`);
		}
		// page.on('console', (e) => console.log(e.text()));
		return page;
	}
}

/**
 * This function will be serialized and then reassembled in the page runtime.
 * Really, just a fancy eval() that can accept arguments.
 */
function smuggledUnjunk(svgCode: string, options?: Options): Promise<string> {
	// unjunk() is not a real function!
	// It is defined in the page JS runtime, not this (node.js) one!
	return window.unjunk(svgCode, options);
}

/**
 * Unjunk runner.
 * Avoid creating multiple instances of this class as the instantiation is really heavy!
 * Typically you'll need just one
 * Don't forget to run .destroy() when you're done!
 */
export class SvgUnjunk {
	private readonly _pool: PagePool;

	// Public signature
	public constructor(options?: ConstructorOptions);
	// Signature for the harsh non-typed JavaScript world
	public constructor(options?: ActuallyUnknown<ConstructorOptions>) {
		const typedOptions: ConstructorOptions = {};
		if (options && options.parallel !== undefined) {
			typedOptions.parallel = Number(options.parallel);
		}
		if (options && options.headless !== undefined) {
			typedOptions.headless = Boolean(options.headless);
		}
		this._pool = new PagePool(typedOptions);
	}

	/**
	 * Unjunks a single SVG image
	 * @param svgCode SVG image source code
	 * @returns Unjunked SVG code
	 */
	public async process(svgCode: string, options?: Options): Promise<string>;
	public async process(svgCode: unknown, options: ActuallyUnknown<Options>): Promise<string> {
		const typedOptions: puppeteer.Serializable = {};
		if (options && options.scale !== undefined) {
			const scale = Number(options.scale);
			if (scale > 0) {
				typedOptions.scale = scale;
			}
		}
		if (options && options.lossless !== undefined) {
			typedOptions.lossless = Boolean(options.lossless);
		}

		const page = await this._pool.alloc();
		try {
			return await page.evaluate(smuggledUnjunk, String(svgCode), typedOptions);
		} finally {
			this._pool.free(page);
		}
	}

	/**
	 * Destroys the instance.
	 * Make sure you call .destroy() after you've finished to free memory and let node.js script exit.
	 */
	public destroy(): void {
		this._pool.destroy();
	}
}

