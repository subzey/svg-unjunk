///<reference types="../interface"/>

interface IImageComparator {
	compare(svgCodeA: string, svgCodeB: string, scale: number): Promise<number>;
	// Used for debug
	constructor?: { name?: string };
}

/** Returns the number of operations to backtrack if successfull */
type CleaningOp = () => {
	backtrack: number;
	forceLossless: boolean;
};

class SvgRasterizer {
	private _imagePromise: Promise<HTMLImageElement>;
	private _scaledImageDataCache: Map<number, Promise<ImageData>> = new Map();

	public constructor(svgCode: string) {
		this._imagePromise = this._createImage(svgCode);
	}

	public getImageData(scale: number): Promise<ImageData> {
		let imageDataPromise = this._scaledImageDataCache.get(scale);
		if (!imageDataPromise) {
			imageDataPromise = this._createImageData(scale);
			this._scaledImageDataCache.set(scale, imageDataPromise);
		}
		return imageDataPromise;
	}

	private async _createImageData(scale: number): Promise<ImageData> {
		const image = await this._imagePromise;

		// TODO: Use the shared canvas
		const canvas = document.createElement('canvas');
		// No alpha no problems
		const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D; // Let it crash
		const width = Math.ceil(image.naturalWidth * scale);
		const height = Math.ceil(image.naturalHeight * scale);

		// If the image is drawn directly on canvas, the rasterization may differ
		// between headless and non-headless puppeteer modes
		const imageBitmap = await createImageBitmap(image, {
			premultiplyAlpha: 'none',
			colorSpaceConversion: 'none',
			resizeWidth: width,
			resizeHeight: height,
			resizeQuality: 'high',
		});

		// Also resets the canvas
		canvas.width = width;
		canvas.height = height;

		ctx.drawImage(imageBitmap, 0, 0, width, height);
		return ctx.getImageData(0, 0, width, height);
	}

	private async _createImage(svgCode: string): Promise<HTMLImageElement> {
		const url = URL.createObjectURL(
			new Blob([svgCode], { type: 'image/svg+xml' })
		);
		try {
			return await new Promise((r, rj) => {
				const im = new Image;
				im.style.imageRendering = 'optimizeQuality';
				im.onload = () => r(im);
				im.onerror = rj;
				im.src = url;
			});
		} finally {
			URL.revokeObjectURL(url);
		}
	}
}

class ImageComparator implements IImageComparator {
	private _baseScale: number;
	private _rasterizerCache: Map<string, SvgRasterizer> = new Map();

	public constructor(baseScale: number) {
		this._baseScale = baseScale;
	}

	/**
	 * Compare two svg codes as images and return some numeric score.
	 * @return A numeric score. Zero if images are identical, positive if not.
	 */
	public async compare(svgCodeA: string, svgCodeB: string, scale: number): Promise<number> {
		const rasterizerA = this._rasterizerCache.get(svgCodeA) || new SvgRasterizer(this._transformCode(svgCodeA));
		const rasterizerB = this._rasterizerCache.get(svgCodeB) || new SvgRasterizer(this._transformCode(svgCodeB));

		const [imageDataA, imageDataB] = await Promise.all([
			rasterizerA.getImageData(scale * this._baseScale),
			rasterizerB.getImageData(scale * this._baseScale),
		]);

		// Rebuild the cache so it won't fill up with useless values
		this._rasterizerCache.clear();
		this._rasterizerCache.set(svgCodeA, rasterizerA);
		this._rasterizerCache.set(svgCodeB, rasterizerB);

		return this._compareImageData(imageDataA, imageDataB);
	}

	protected _transformCode(svgCode: string): string {
		return svgCode;
	}

	protected _compareImageData(imageDataA: ImageData, imageDataB: ImageData): number {
		const a = imageDataA.data;
		const b = imageDataB.data;

		if (imageDataA.width !== imageDataB.width || imageDataA.height !== imageDataB.height) {
			throw new Error('ImageData with different sizes are not comparable');
		}

		let difference = 0;
		for (let i = 0; i < a.length; i += 4) {
			difference += Math.hypot(
				a[i + 0] - b[i + 0], // R
				a[i + 1] - b[i + 1], // G
				a[i + 2] - b[i + 2], // B
				// a[i + 3] - b[i + 3]  // Alpha
			);
		}
		return difference;
	}
}

class DefaultImageComparator extends ImageComparator {
	protected _transformCode(svgCode: string): string {
		const doc = parse(svgCode);
		if (!doc.documentElement.style.background) {
			doc.documentElement.style.background = '#fff';
		}
		return serialize(doc);
	}
}

class RecoloredImageComparator extends ImageComparator {
	protected _transformCode(svgCode: string): string {
		const doc = parse(svgCode);

		if (!doc.documentElement.style.background) {
			doc.documentElement.style.background = '#000';
		}

		if (!(doc.documentElement.style.fill || doc.documentElement.getAttribute('fill') || '').trim()) {
			doc.documentElement.style.fill = '#f0f';
		}

		if (!doc.documentElement.style.color) {
			doc.documentElement.style.color = '#ff0';
		}

		return serialize(doc);
	}
}

const doNotRemoveAttrs = new Set([
	'xmlns', 'viewBox',
	'width', 'height',
	'r', 'rx', 'ry', 'cx', 'cy',
	'x', 'y', 'x1', 'x2', 'y1', 'y2',
	'd',
	'offset', 'stop-color',
	'filterUnits',
]);
const unwrapElements = new Set(['g', 'svg']);

const RE_URL_FUNCTION = /^\s*url\(\s*(.*?)\s*\)$/i;
const RE_XMLNS_ATTR = /^xmlns(?:|$)/;

// xmlns: attributes should be the last ones to be removed
function sortAttrs(attrNames: string[]): string[] {
	for (let i = attrNames.length; i-- > 0;) {
		if (RE_XMLNS_ATTR.test(attrNames[i])) {
			attrNames.push(attrNames[i]);
			attrNames.splice(i, 1);
		}
	}
	return attrNames;
}

function * inlineGradient(grad: SVGLinearGradientElement | SVGRadialGradientElement): IterableIterator<CleaningOp> {
	if (!grad.hasAttribute('id')) {
		return;
	}
	const gradRef = `#${grad.getAttribute('id') || ''}`;
	const refStop = grad.querySelector('stop');
	if (!refStop) {
		return;
	}
	const refColor = refStop.getAttribute('stop-color') || 'black';
	const refOpacity = refStop.getAttribute('stop-opacity') || '1';
	yield () => {
		for (const attrName of ['fill', 'stroke'] as const) {
			for (const el of Array.from(grad.ownerDocument.querySelectorAll(`[${attrName}]`))) {
				const attrMatch = RE_URL_FUNCTION.exec(el.getAttribute(attrName) || '');
				if (attrMatch && attrMatch[1] === gradRef) {
					el.setAttribute(attrName, refColor);
					el.setAttribute(`${attrName}-opacity`, refOpacity);
				}
			}

		}
		grad.remove();
		// We've changed the document significantly and now have to
		// backtrack back to the start
		return {
			backtrack: Infinity,
			forceLossless: false,
		};
	}
}

function * cleaningOps(parentNode: Document | Element): IterableIterator<CleaningOp> {
	for (const child of Array.from(parentNode.childNodes)) {
		// // Leave leading comments
		// if (child.nodeType === Node.COMMENT_NODE && parentNode.nodeType !== Node.ELEMENT_NODE && parentNode.firstChild === child) {
		// 	continue;
		// }

		if (parentNode.nodeType === Node.ELEMENT_NODE || child.nodeType !== Node.ELEMENT_NODE) {
			yield () => {
				child.remove();
				return {
					backtrack: 0,
					forceLossless: false,
				};
			};
		}

		if (child.nodeType !== Node.ELEMENT_NODE) {
			continue;
		}

		const el = child as SVGElement;

		yield * cleaningOps(el);

		if (el.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')) {
			yield () => {
				for (const attrNode of Array.from(el.attributes)) {
					if (attrNode.nodeValue === null) {
						// Quite unlikely with XML
						continue;
					}
					el.removeAttribute(attrNode.name);
					if (attrNode.namespaceURI === 'http://www.w3.org/1999/xlink' && attrNode.localName === 'href') {
						el.setAttribute('href', attrNode.nodeValue);
					} else {
						// Replace the attribute with itself: keep the attr order
						el.setAttribute(attrNode.name, attrNode.nodeValue);
					}
				}
				return {
					backtrack: 0,
					forceLossless: false,
				};
			}
		}

		const attrNames = sortAttrs(Array.from(el.attributes, attr => attr.name));
		for (const attrName of attrNames) {
			if (doNotRemoveAttrs.has(attrName)) {
				continue;
			}
			yield () => {
				el.removeAttribute(attrName);
				return {
					backtrack: 0,
					forceLossless: attrName.startsWith('stroke-'),
				};
			}
		}

		for (const className of Array.from(el.classList)) {
			yield () => {
				el.classList.remove(className);
				return {
					backtrack: 0,
					forceLossless: false,
				};
			}
		}

		for (const styleProp of Array.from(el.style)) {
			yield () => {
				el.style.removeProperty(styleProp);
				return {
					backtrack: 0,
					forceLossless: styleProp.startsWith('stroke-'),
				};
			}
		}

		if (el.nodeName === 'linearGradient' || el.nodeName === 'radialGradient') {
			yield * inlineGradient(el as SVGLinearGradientElement | SVGRadialGradientElement);
		}

		if (unwrapElements.has(el.nodeName) && parentNode.nodeType === Node.ELEMENT_NODE) {
			yield () => {
				el.replaceWith(...Array.from(el.childNodes));
				return {
					backtrack: 1,
					forceLossless: false,
				};
			}
		}
	}
}

function parse(svgCode: string): XMLDocument {
	const doc = new DOMParser().parseFromString(svgCode, 'image/svg+xml');
	if (doc.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg') {
		const errElement = doc.querySelector('parsererror > h3:first-child + div');
		if (errElement && errElement.textContent) {
			throw new SyntaxError(`SVG parse error: ${errElement.textContent.slice(0, 256)}`);
		}

		if (doc.documentElement.namespaceURI !== null) {
			throw new SyntaxError(`SVG parse error: The namespace should be "http://www.w3.org/2000/svg"`);
		}

		// Try to recover.
		// Setting an xmlns attribute doesn't change the document flavor
		// We have to re-parse it
		doc.documentElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
		return parse(serialize(doc));
	}

	if (doc.documentElement.nodeName !== 'svg') {
		throw new SyntaxError(`SVG parse error: The document element tag should be "svg" in lowercase`);
	}

	return doc;
}

function serialize(doc: XMLDocument): string {
	return new XMLSerializer().serializeToString(doc);
}

async function assertVisuallySame(svgCodeA: string, svgCodeB: string, comparators: readonly IImageComparator[], lossless?: boolean): Promise<void> {
	for (const comparator of comparators) {
		const defectScore1x = await comparator.compare(svgCodeA, svgCodeB, 1);
		// console.log(`Defect score 1x ${defectScore1x}`);
		if (defectScore1x <= 0) {
			// 1x images are exactly the same (or better than the same?)
			continue;
		}
		if (lossless) {
			throw new Error(`[${comparator?.constructor?.name}] Not lossless, defect score is ${defectScore1x}`);
		}
		// Scale the same image twice getting 4x more pixels and estimate the defect again
		const defectScore2x = await comparator.compare(svgCodeA, svgCodeB, 2);
		// console.log(`Defect score 2x ${defectScore2x} (defectScore2x / defectScore1x)`);

		// The ratio shows how the defect scales as the image is scaled up.
		// >= (2 ** 2) means the area defect: as there's 4x pixels there's 4x defect.
		// <= (2 ** 1) means the linear defect: as there's 4x pixels, there's 2x defect.
		// The threshold is somewhere in between
		const defectScale = defectScore2x / defectScore1x;
		if (defectScale >= 2 ** 1.5) {
			throw new Error(`[${comparator?.constructor?.name}] Area defect, scales as ${defectScale}`)
		}
	}
}

window.unjunk = async function unjunk(svgCode: string, options: Partial<Options> = {}) {
	const scale = options.scale ?? 2;
	const lossless = Boolean(options.lossless);

	const comparators: readonly IImageComparator[] = [new DefaultImageComparator(scale), new RecoloredImageComparator(scale)];
	const originalAttrs = getAttrs(svgCode);

	let skipOps = 0;
	outer: for (let i = 0; i < 1000; i++) {
		if (i >= 1000) {
			console.log('Bailing out');
			break;
		}
		// console.log('starting over');
		const doc = parse(svgCode);
		const opGenerator = cleaningOps(doc);

		for (let opNumber = 0; ; opNumber++) {
			const { done, value: op } = opGenerator.next();
			if (done) {
				break outer;
			}
			if (opNumber < skipOps) {
				continue;
			}
			skipOps = opNumber + 1;
			// console.log(op);
			try {
				const { backtrack, forceLossless } = op();
				const newSvgCode = serialize(doc);
				if (newSvgCode === svgCode) {
					// Operation changed nothing, we can continue this loop
					continue;
				}

				// console.log(newSvgCode);

				await assertVisuallySame(newSvgCode, svgCode, comparators, lossless || forceLossless);

				// console.log('\tAccepted')
				svgCode = newSvgCode;
				skipOps = Math.max(opNumber - backtrack, 0);
			} catch (e) {
				// console.log('\t' + e.message);
			}
			break;
		}
	}

	// Chromium DOM implementation always sets the xmlns attribute first
	// Restore the original order to get a minimal diff
	svgCode = fixAttrOrder(svgCode, originalAttrs);
	return svgCode;
}


interface PhysAttr {
	name: string,
	raw: string,
	start: number,
	end: number,
}

/**
 * It's not a spec compliant parser!
 * But it's good enough to reorder attributes.
 */
function getAttrs(svgCode: string): PhysAttr[] {
    const attrs: PhysAttr[] = [];
    const start = svgCode.indexOf('<svg');
    if (start === -1) {
        return attrs;
    }

    const reAttr = /\s+([^\s<>&'"]+)\s*=\s*("|')[^]*?\2/igy;
    reAttr.lastIndex = start + 4;
	for (let match = reAttr.exec(svgCode); match !== null; match = reAttr.exec(svgCode)) {
        attrs.push({
            name: match[1],
            raw: match[0],
			start: match.index,
			end: reAttr.lastIndex,
        });
	}

	return attrs;
}

function fixAttrOrder(svgCode: string, originalAttrs: readonly PhysAttr[]): string {
	const newAttrs = getAttrs(svgCode);
	console.log(newAttrs, originalAttrs);
	if (newAttrs.length === 0) {
		return svgCode;
	}
	const sliceStart = newAttrs[0].start;
	const sliceEnd = newAttrs[newAttrs.length - 1].end;

	const attrOrder: Map<string, number> = new Map();
	for (let i = 0; i < newAttrs.length; i++) {
		attrOrder.set(newAttrs[i].name, i);
	}
	for (let i = 0; i < originalAttrs.length; i++) {
		attrOrder.set(originalAttrs[i].name, newAttrs.length + i);
	}

	newAttrs.sort((a: PhysAttr, b: PhysAttr) => (attrOrder.get(a.name) as number) - (attrOrder.get(b.name) as number));
	return svgCode.slice(0, sliceStart) + newAttrs.map((physAttr: PhysAttr) => physAttr.raw).join('') + svgCode.slice(sliceEnd);
}
