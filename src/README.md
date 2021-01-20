# svg-unjunk

Removes invisible and useless stuff from SVG code. It uses real Chromium to render and compare rasterized SVGs.

## Command line usage

```
npx svg-unjunk [OPTIONS] FILE [FILE...]
```

```sh
npx svg-unjunk svgfile.svg anothersvgfile.svg
```

### --lossless

Use only transformations that makes the rasterized image look exactly, pixel perfect, the same.

Chromim SVG rasterizer may leave barely noticeable rendering artifacts that aren't visible to the naked eye.
In `--lossless` mode these transfromations will be rejected.

Typically running in near-lossless (without `--lossless`) mode is good enough.

### --parallel

Use several Chromium pages for raserization and optimization at once.

Defaults to the # of CPUs on your machine.

### --scale

Upscale the image # times when rasterizing.

Ex: If the SVG image is 50 × 50 and `--scale` is 2, it will be rasterized (and compared) as 100 × 100.

Default is `2` ("retina").

### --debug

Shows the Chromium window and probably some additional debug info.


## Node.js module usage

```js
const { SvgUnjunk } = require('svg-unjunk');
const unjunk = new SvgUnjunk(/* options */);

const newSvgCode1 = await unjunk.process(oldSvgCode1 /*, options */);
const newSvgCode2 = await unjunk.process(oldSvgCode2 /*, options */);
// ...

unjunk.destroy();
```

Please refer the `index.d.ts` for the full interface documentation.

### .destroy() it!

svg-unjunk uses puppeteer and it opens a real Chromium browser. Unfortunately, there's no way to `.unref()` it so far.
If you don't call `destroy` the node.js script will not exit clean:
It will wait util the browser process end at it will never happen.

### new SvgUjunk() is heavy!

Reuse the same instance as much as you can! Each new `SvgUnjunk` instance starts a new browser and it's really not a fast thing to do.

In fact, if you reuse the same instance you can benefit from the parallel processing.
