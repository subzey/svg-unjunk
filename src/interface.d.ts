interface Options {
	scale?: number;
	lossless?: boolean;
}

interface Window {
	unjunk(svgCode: string, options?: Options): Promise<string>;
}
