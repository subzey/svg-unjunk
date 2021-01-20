## 1. Install node.js dependencies

```sh
npm install
```

You may do it once.

## 2. Build the code

```sh
npm run build
```

The compilation result is in the `./dist/` directory.

## 3. Test it

```sh
npm test
```

Successful tests removes the `private` flag in `dist/package.json` so you can publish it.

## Directory layout

`./dist/` is where the module ready for npm publishing is.

`./src/` is the source both for the final product and for some housekeeping scripts.

`./build/` is a staging directory. The compiled TypeScript fileas are thare, as well as build info that speeds up the next build. Also the housekeeping files like `test.js` are there.

`./test/` contains some test cases.
